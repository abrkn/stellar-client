var assert = require('assert')
var _ = require('lodash')
var StellarLib = require('stellar-lib')
var DEFAULT_FEE = 10

module.exports = function(stellar, txJson, secret, cb) {
    txJson = _.clone(txJson)
    txJson.Fee || (txJson.Fee = DEFAULT_FEE)

    // Determine the account sequence
    var req = { account: txJson.Account }

    stellar.request('account_info', req, function(err, res) {
        if (err) return cb(err)

        assert(res.account_data.Sequence)
        txJson.Sequence = res.account_data.Sequence

        var tx = new StellarLib.Transaction()
        tx.remote = null
        tx.tx_json = txJson
        tx._secret = secret
        tx.complete()
        tx.sign()

        var hex = tx.serialize().to_hex()

        cb(null, { tx_blob: hex })
    })
}
