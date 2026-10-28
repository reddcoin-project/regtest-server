// Brings a fresh Reddcoin regtest chain to BOOTSTRAP_HEIGHT and produces all
// later blocks. Past nLastPowHeight (89) blocks are proof-of-stake: the wallet
// only finds a valid coinstake if block times are spaced, so every block is
// generated at mocktime = max(tip + SPACING, now). On a fresh chain the first
// block starts SPACING * height seconds in the past, so the tip ends near now.
let debug = require('debug')('bootstrap')
let rpc = require('./rpc')

let SPACING = 60
let HEIGHT = parseInt(process.env.BOOTSTRAP_HEIGHT || '432')
let REQUIRE = (process.env.REQUIRE_DEPLOYMENTS || 'cltv csv segwit taproot').split(/[\s,]+/).filter(x => x)
let WALLET = 'default'

let state = { ready: false, height: null, error: null }

let sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let now = () => Math.floor(Date.now() / 1000)
let call = (method, ...params) => new Promise((resolve, reject) => {
  rpc(method, params, (err, result) => err ? reject(err) : resolve(result))
})

async function waitForNode () {
  let deadline = Date.now() + 120000
  for (;;) {
    try {
      return await call('getblockcount')
    } catch (err) {
      if (Date.now() > deadline) throw err
      debug(`waiting for node: ${err.message}`)
      await sleep(1000)
    }
  }
}

async function ensureWallet () {
  if ((await call('listwallets')).includes(WALLET)) return
  try {
    await call('loadwallet', WALLET)
  } catch (err) {
    await call('createwallet', WALLET)
  }
}

// one generation at a time: mocktime is node-global
let queue = Promise.resolve()

// backfillFrom: generate blocks SPACING apart starting at that time (bootstrap),
// rather than catching up to the wall clock
function generate (count, address, backfillFrom) {
  let run = queue.then(async () => {
    if (!address) address = await call('getnewaddress')
    let hashes = []
    for (let i = 0; i < count; i++) {
      let tip = await call('getblockheader', await call('getbestblockhash'))
      let floor = backfillFrom ? (i === 0 ? backfillFrom : 0) : now()
      let time = Math.max(tip.time + SPACING, floor)
      await call('setmocktime', time)
      hashes.push(...await call('generatetoaddress', 1, address))
    }
    return hashes
  })
  queue = run.catch(() => {})
  return run
}

async function checkDeployments () {
  let { softforks } = await call('getblockchaininfo')
  let inactive = REQUIRE.filter(name => !(softforks[name] && softforks[name].active))
  if (inactive.length) {
    throw new Error(`deployments not active: ${inactive.join(', ')} (start reddcoind with -vbparams=<name>:0:9223372036854775807)`)
  }
}

async function run () {
  try {
    let height = await waitForNode()
    await ensureWallet()

    if (height < HEIGHT) {
      let started = Date.now()
      let backfillFrom = now() - SPACING * (HEIGHT - height)
      debug(`generating ${HEIGHT - height} blocks from height ${height}`)
      await generate(HEIGHT - height, undefined, backfillFrom)
      debug(`bootstrapped to ${HEIGHT} in ${Date.now() - started} ms`)
    }

    await checkDeployments()
    state.height = await call('getblockcount')
    state.ready = true
    debug(`ready at height ${state.height}`)
  } catch (err) {
    state.error = err.message
    console.error(`bootstrap failed: ${err.message}`)
  }
}

module.exports = { run, generate, state }
