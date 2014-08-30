var _ = require('lodash')
var EventEmitter = require('events').EventEmitter
var util = require('util')
var debug = require('debug')('stellar-client:acctmon')
var async = require('async')
var assert = require('assert')
var MAX_TRANSACTIONS = 200

module.exports = exports = function(opts) {
    _.bindAll(this)
    this.opts = opts
    this.stellar = opts.stellar
    this.stellar.on('open', this.stellarOpen)
    this.stellar.on('close', this.stellarClose)
    this.stellar.on('transaction', this.stellarTransaction)
    this.stellar.on('ledgerclosed', this.stellarLedgerClosed)
    this.internalLedger = opts.ledgerIndex || 0
    this.accounts = {}
}

util.inherits(exports, EventEmitter)

exports.prototype.stellarOpen = function() {
    this.live = false
    this.processedHashes = []

    async.series([
        // Attach existing subscriptions
        function(cb) {
            debug('attaching existing subscriptions...')
            async.each(Object.keys(this.accounts), function(account, cb) {
                debug('subscribing to %s', account)
                this.subscribeToAccount(account, cb)
            }.bind(this), cb)
        }.bind(this),

        // Catch up from internal ledger to the closed one
        function(cb) {
            debug('catching up from ledger #%s...', this.internalLedger + 1)
            async.each(Object.keys(this.accounts), function(account, cb) {
                this.catchupAccount(account, this.internalLedger + 1, cb)
            }.bind(this), cb)
        }.bind(this),

        // Subscribe to ledger closes
        function(cb) {
            debug('subscribing to ledger close...')
            this.subscribeToLedgerClose(function(err) {
                if (err) return cb(err)
                debug('subscribed to ledger close')
                cb()
            })
        }.bind(this)
    ], function(err) {
        if (err) {
            var wrappedErr = new Error('Initialization failed: ' + err.message)
            wrappedErr.inner = err
            return this.emit('error', wrappedErr)
        }
        this.live = true
        this.processedHashes = null
        debug('caught up and live')
    }.bind(this))
}

exports.prototype.stellarLedgerClosed = function(message) {
    assert.equal(this.live, true)

    debug('ledger %s closed', message.ledger_index)

    this.internalLedger = message.ledger_index
    this.emit('ledgerclosed', message.ledger_index)

    Object.keys(this.accounts).forEach(function(account) {
        this.catchupAccount(account, message.ledger_index, function(err) {
            if (!err) return
            console.error('failed to catch up %s from closed ledger %s: %s',
                account, message.ledger_index, err.message)
        }.bind(this))
    }.bind(this))
}

exports.prototype.catchupAccount = function(account, from, cb) {
    var that = this

    function next(marker) {
        var options = {
            account: account,
            ledger_index_min: from,
            ledger_index_max: -1,
            marker: marker || null,
            limit: MAX_TRANSACTIONS
        }

        if (marker !== undefined) {
            options.marker = marker
        }

        that.stellar.request('account_tx', options, function(err, res) {
            if (err) return cb(err)
            assert(res.transactions)
            res.transactions.forEach(function(tx) {
                if (tx.meta.TransactionResult != 'tesSUCCESS') {
                    console.log('ignoring tx %s with transaction result %s',
                        tx.tx.hash, tx.meta.TransactionResult)
                    return
                }
                that.processTransaction(tx.tx)
            }.bind(that))
            if (!res.marker) return cb()
            next(res.marker)
        }.bind(that))
    }

    next()
}

exports.prototype.subscribeToLedgerClose = function(cb) {
    this.stellar.request('subscribe', {
        streams: ['ledger']
    }, cb)
}

exports.prototype.stellarClose = function() {
    debug('disconnected from stellar')
}

exports.prototype.subscribeToAccount = function(account, cb) {
    this.stellar.request('subscribe', {
        accounts: [account]
    }, cb)
}

exports.prototype.account = function(account, cb) {
    debug('adding subscription to account %s', account)
    var item = this.accounts[account]
    if (!item) {
        item = (this.accounts[account] = [])
        if (this.stellar.connected) {
            this.subscribeToAccount(account)
        }
    }
    item.push(cb)
}

exports.prototype.stellarTransaction = function(tx) {
    this.processTransaction(tx)
}

exports.prototype.processTransaction = function(tx) {
    if (tx.TransactionType != 'Payment') {
        return debug('Ignoring tx type %s', tx.TransactionType)
    }

    if (!this.live) {
        // Has the transaction already been processed by catch-up?
        if (~this.processedHashes.indexOf(tx.hash)) return

        this.processedHashes.push(tx.hash)
    }

    _.each(this.accounts, function(subs, account) {
        if (account != tx.Destination) return
        subs.forEach(function(sub) {
            sub(tx)
        })
    })
}
