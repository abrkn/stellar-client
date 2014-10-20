var assert = require('assert')
var debug = require('debug')('stellar-client:tracked-submit')
var util = require('util')
var lodash = require('lodash')

function wrapError(inner, msg, name) {
    var err = new Error(msg)
    err.inner = inner
    err.name = name
    return err
}

var TrackedSubmit = function(opts) {
    lodash.bindAll(this)

    this.client = opts.client
    this.opts = opts || {}

    assert(this.client, 'client must be set')
    assert.equal(this.client.opts.allTransactions, true, 'allTransactions must be set on the client')
}

TrackedSubmit.prototype.forceWsClose = function() {
    this.client.conn.ws.close()
}

TrackedSubmit.prototype.verify = function(hash, cb) {
    debug('looking up tx...')

    var retry = this.verify.bind(this, hash, cb)

    this.client.request('tx', { transaction: hash }, function(err, tx) {
        if (err) {
            if (err.message.match(/^Not synced/)) {
                debug('not synced error when looking up tx')
                this.forceWsClose()
                this.client.once('open', retry)
                return
            }

            return cb(err)
        }

        debug('found tx')
        debug('%j', tx)

        assert.equal(tx.hash, hash)

        if (tx.meta && tx.meta.TransactionResult == 'tesSUCCESS') {
            assert(tx.inLedger)
            debug('tx is a success and is included in ledger %s', tx.inLedger)
            return cb(null, hash)
        }

        setTimeout(retry, 2.5e3)
    }.bind(this))
}

TrackedSubmit.prototype.submitAndVerify = function(hex, cb) {
    this.client.request('submit', { tx_blob: hex }, function(err, res) {
        if (err) {
            console.error('submit error', err.name, err)
            err.sent = null
            return cb(err)
        }

        if (res.engine_result == 'tesSUCCESS') {
            this.verify(res.tx_json.hash, cb)
            return
        }

        err = new Error(res.engine_result)
        err.sent = false
        return cb(err)
    }.bind(this))
}

TrackedSubmit.prototype.send = function(hex, cb) {
    if (!this.client.connected) {
        debug('waiting for open...')
        this.client.once('open', function() {
            this.send(hex, cb)
        }.bind(this))
        return
    }

    debug('submitting')

    this.submitAndVerify(hex, cb)
}

module.exports = TrackedSubmit
