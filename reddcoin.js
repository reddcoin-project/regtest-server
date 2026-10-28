// Reddcoin helpers shared by the routes, bootstrap and scripts
let crypto = require('crypto')
let ecc = require('tiny-secp256k1')
let rdd = require('@reddcoinproject/reddcoinjs-lib')

// P2TR address encoding (addressOf) needs the ECC library
rdd.initEccLib(ecc)

// Reddcoin Core regtest parameters (chainparams.cpp, CRegTestParams)
let NETWORK = {
  messagePrefix: '\x19Reddcoin Signed Message:\n',
  bech32: 'rcrt',
  bip32: {
    public: 0x043587cf,
    private: 0x04358394
  },
  pubKeyHash: 0x7a,
  scriptHash: 0x05,
  wif: 0xef
}

function sha256Hex (buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// JSON has no bigint: amounts that fit a Number stay numbers (what regtest-client
// expects), larger ones are sent as decimal strings rather than rounded
function jsonValue (value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
}

function addressOf (script) {
  try {
    return rdd.address.fromOutputScript(script, NETWORK)
  } catch (e) {
    return undefined
  }
}

module.exports = { rdd, NETWORK, sha256Hex, jsonValue, addressOf }
