let { get: indexd } = require('../service')
let bodyParser = require('body-parser')
let debug = require('debug')('1')
let ecc = require('tiny-secp256k1')
let { ECPairFactory } = require('ecpair')
let fs = require('fs')
let parallel = require('run-parallel')
let rpc = require('../rpc')
let bootstrap = require('../bootstrap')
let typeforce = require('typeforce')
let { rdd, NETWORK, sha256Hex, jsonValue, addressOf } = require('../reddcoin')
let isHex64 = typeforce.HexN(64)

let ECPair = ECPairFactory(ecc)
let DBLIMIT = 440 // max sequential leveldb walk

let pRpc = (cmd, args) => new Promise((resolve, reject) => {
  rpc(cmd, args, (err, data) => {
    if (err) return reject(err)
    else return resolve(data)
  })
})

let pUtxosByScriptRange = scId => new Promise((resolve, reject) => {
  indexd().utxosByScriptRange({
    scId, heightRange: [0, 0xffffffff], mempool: true
  }, DBLIMIT, (err, data) => {
    if (err) return reject(err)
    else return resolve(data)
  })
})

// indexd returns bigint values; JSON needs numbers (or strings above 2^53)
function txosJSON (txos) {
  return txos.map(txo => Object.assign({}, txo, { value: jsonValue(txo.value) }))
}

// Parsed from the raw transaction, so values are exact (verbose RPC JSON is not)
function txJSON (hex) {
  let tx = rdd.Transaction.fromHex(hex)
  return {
    txId: tx.getId(),
    txHex: hex,
    vsize: tx.virtualSize(),
    version: tx.version,
    locktime: tx.locktime,
    nTime: tx.nTime,
    ins: tx.ins.map((x) => {
      return {
        txId: Buffer.from(x.hash).reverse().toString('hex'),
        vout: x.index,
        script: Buffer.from(x.script).toString('hex'),
        sequence: x.sequence
      }
    }),
    outs: tx.outs.map((x) => {
      return {
        address: addressOf(x.script),
        script: Buffer.from(x.script).toString('hex'),
        value: jsonValue(x.value)
      }
    })
  }
}

module.exports = function (router, callback) {
  function addressWare (req, res, next) {
    const { address } = req.params
    try {
      let script = !address.match(/^[0-9a-f]+$/i)
        ? rdd.address.toOutputScript(address, NETWORK)
        : Buffer.from(address, 'hex')
      req.params.scId = sha256Hex(script)
    } catch (e) { return res.easy(400) }
    next()
  }

  router.get('/ready', (req, res) => {
    res.status(bootstrap.state.ready ? 200 : 503).json(bootstrap.state)
  })

  router.get('/a/:address/firstseen', addressWare, (req, res) => {
    let { scId } = req.params
    indexd().firstSeenScriptId(scId, res.easy)
  })

  router.get('/a/:address/txs', addressWare, (req, res) => {
    let { scId } = req.params

    indexd().transactionIdsByScriptRange({
      scId, heightRange: [0, 0xffffffff], mempool: true
    }, DBLIMIT, (err, txIds) => {
      if (err) return res.easy(err)

      parallel(txIds.map((txId) => {
        return (next) => rpc('getrawtransaction', [txId], next)
      }), res.easy)
    })
  })

  router.get('/a/:address/txids', addressWare, (req, res) => {
    let { scId } = req.params

    indexd().transactionIdsByScriptRange({
      scId, heightRange: [0, 0xffffffff], mempool: true
    }, DBLIMIT, res.easy)
  })

  router.get('/a/:address/txos', addressWare, (req, res) => {
    let { scId } = req.params
    indexd().txosByScriptRange({
      scId, heightRange: [0, 0xffffffff], mempool: true
    }, DBLIMIT, (err, txos) => res.easy(err, txos && txosJSON(txos)))
  })

  router.get('/a/:address/unspents', addressWare, (req, res) => {
    let { scId } = req.params
    indexd().utxosByScriptRange({
      scId, heightRange: [0, 0xffffffff], mempool: true
    }, DBLIMIT, (err, utxos) => res.easy(err, utxos && txosJSON(utxos)))
  })

  router.get('/a/alt/:address/unspents', addressWare, async (req, res) => {
    // This is added to mimic a certain API for educational use.
    try {
      let { scId } = req.params
      const unspents = await pUtxosByScriptRange(scId)
      const results = await Promise.all(unspents.map(async (unspent) => {
        const txo = await new Promise((resolve, reject) => indexd().txoByTxo(unspent, (err, txo) => err ? reject(err) : resolve(txo)))
        const address = txo && addressOf(txo.script)
        return {
          value_int: jsonValue(unspent.value),
          txid: unspent.txId,
          n: unspent.vout,
          ...(!address ? {} : { addresses: [address] }),
          ...(!txo ? {} : {
            script_pub_key: {
              asm: rdd.script.toASM(txo.script),
              hex: txo.script.toString('hex')
            }
          })
        }
      }))
      res.easy(undefined, results)
    } catch (err) {
      res.easy(err)
    }
  })

  router.get('/t/mempool', (req, res) => {
    rpc('getrawmempool', [false], res.easy)
  })

  router.post('/t/push', bodyParser.text(), (req, res) => {
    rpc('sendrawtransaction', [req.body], (err) => {
      if (err && /./.test(err.message)) return res.easy(err, err.message)
      res.easy(err)
    })
  })

  router.post('/t/alt/pushtx', bodyParser.json(), (req, res) => {
    // This mimics other api
    rpc('sendrawtransaction', [req.body.hex], (err) => {
      if (err && /./.test(err.message)) return res.easy(err, err.message)
      res.easy(err)
    })
  })

  function hexWare (req, res, next) {
    if (!isHex64(req.params.id)) return res.easy(400)
    next()
  }

  router.get('/t/:id', hexWare, (req, res) => {
    rpc('getrawtransaction', [req.params.id, false], res.easy)
  })

  router.get('/t/:id/json', hexWare, (req, res) => {
    rpc('getrawtransaction', [req.params.id, false], (err, hex) => {
      if (err) return res.easy(err)

      res.easy(null, txJSON(hex))
    })
  })

  router.get('/t/:id/block', hexWare, (req, res) => {
    indexd().blockIdByTransactionId(req.params.id, res.easy)
  })

  router.get('/b/best', (req, res) => {
    rpc('getbestblockhash', [], res.easy)
  })

  router.get('/b/fees', (req, res) => {
    let count = parseInt(req.query.count)
    if (!Number.isFinite(count)) count = 12
    count = Math.min(count, 64)

    indexd().latestFeesForNBlocks(count, (err, results) => {
      if (results) {
        results.forEach((x) => {
          x.kB = Math.floor(x.size / 1024)
        })
      }

      res.easy(err, results)
    })
  })

  function bestInjector (req, res, next) {
    if (req.params.id === 'best') {
      return rpc('getbestblockhash', [], (err, id) => {
        if (err) return next(err)
        req.params.id = id
        next()
      })
    }

    next()
  }

  router.get('/b/:id/header', bestInjector, hexWare, (req, res) => {
    rpc('getblockheader', [req.params.id, false], (err, json) => {
      if (err && /not found/.test(err.message)) return res.easy(err, err.message)
      res.easy(err, json)
    })
  })

  router.get('/b/:id/height', bestInjector, hexWare, (req, res) => {
    rpc('getblockheader', [req.params.id, true], (err, json) => {
      if (err && /not found/.test(err.message)) return res.easy(err, err.message)
      res.easy(err, err ? undefined : json.height)
    })
  })

  let AUTH_KEYS = {}

  // regtest features
  function authMiddleware (req, res, next) {
    if (!req.query.key) return res.easy(401)
    let hash = sha256Hex(req.query.key)
    if (hash in AUTH_KEYS) return next()
    res.easy(401)
  }

  // PoS blocks: generated through bootstrap, which manages mocktime so the
  // wallet can always stake
  router.post('/r/generate', authMiddleware, (req, res) => {
    let count = parseInt(req.query.count) || 1
    bootstrap.generate(count, req.query.address).then(
      hashes => res.easy(null, hashes),
      err => res.easy(err, err.message)
    )
  })

  router.post('/r/faucet', authMiddleware, (req, res) => {
    rpc('sendtoaddress', [req.query.address, parseInt(req.query.value) / 1e8, '', '', false, false, null, 'unset', false, 1], res.easy)
  })

  // Funds a fresh P2PKH key, then spends it to the requested output script
  router.post('/r/faucetScript', authMiddleware, async (req, res) => {
    try {
      const value = parseInt(req.query.value)
      const key = ECPair.makeRandom({ network: NETWORK })
      const payment = rdd.payments.p2pkh({ pubkey: key.publicKey, network: NETWORK })

      const fundId = await pRpc('sendtoaddress', [payment.address, value * 2 / 1e8, '', '', false, false, null, 'unset', false, 1])
      const fund = rdd.Transaction.fromHex(await pRpc('getrawtransaction', [fundId, false]))
      const vout = fund.outs.findIndex(o => Buffer.from(o.script).equals(Buffer.from(payment.output)))
      if (vout < 0) throw new Error('No outputs')

      const tx = new rdd.Transaction()
      tx.version = 2
      tx.nTime = Math.floor(Date.now() / 1000)
      tx.addInput(fund.getHash(), vout)
      tx.addOutput(Buffer.from(req.query.script, 'hex'), BigInt(value))
      const hash = tx.hashForSignature(0, payment.output, rdd.Transaction.SIGHASH_ALL)
      const signature = rdd.script.signature.encode(key.sign(hash), rdd.Transaction.SIGHASH_ALL)
      tx.setInputScript(0, rdd.script.compile([signature, key.publicKey]))

      await pRpc('sendrawtransaction', [tx.toHex()])
      res.easy(undefined, tx.getId())
    } catch (err) {
      res.easy(err)
    }
  })

  if (!process.env.KEYDB) {
    console.log('KEYDB is not set')
    process.exit(-1)
  } else {
    if (!fs.existsSync(process.env.KEYDB)) {
      console.log(`${process.env.KEYDB} file does not exist`)
      process.exit(-1)
    }
    fs.readFile(process.env.KEYDB, (err, buffer) => {
      if (err) return callback(err)
      buffer
        .toString('utf8')
        .split('\n')
        .filter(x => x)
        .map(x => sha256Hex(x)) // XXX: yes, from plain-text :)
        .forEach(x => (AUTH_KEYS[x] = true))
      debug(`imported ${Object.keys(AUTH_KEYS).length} authorized keys`.toUpperCase())
      callback()
    })
  }
}
