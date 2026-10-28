# regtest-server (Reddcoin)

An [express](https://www.npmjs.com/package/express) HTTP API over a Reddcoin regtest node,
for [regtest-client](https://github.com/bitcoinjs/regtest-client) based integration tests
(such as [reddcoinjs-lib](https://github.com/reddcoin-project/reddcoinjs-lib)'s).
Forked from [bitcoinjs/regtest-server](https://github.com/bitcoinjs/regtest-server).

It uses [reddcoin-project/indexd](https://github.com/reddcoin-project/indexd) for address
indexing and [@reddcoinproject/reddcoinjs-lib](https://www.npmjs.com/package/@reddcoinproject/reddcoinjs-lib)
for transactions.

## Quick start

```bash
docker compose up -d --wait     # node + API; ready in seconds
curl http://127.0.0.1:8080/1/b/best/height
```

`docker-compose.yml` runs two containers:

- `reddcoind`: the stock [`reddcoincore/reddcoind`](https://hub.docker.com/r/reddcoincore/reddcoind)
  image in regtest mode.
- `regtest-server`: this API ([`reddcoincore/reddcoinjs-regtest-server`](https://hub.docker.com/r/reddcoincore/reddcoinjs-regtest-server)).

On start the server creates a wallet and bootstraps the chain to height 432, then `GET /1/ready`
returns 200. The API key for the `/1/r/*` routes is `satoshi`.

## Reddcoin regtest notes

- **Proof of stake.** Blocks after height 89 are PoS, staked by the node's wallet under mocktime.
  Staking needs chain time to pass, so every block, at bootstrap and through `POST /1/r/generate`,
  is at least 60 s after its parent (`max(tip + 60, now)`), and staking is retried further ahead
  when no coinstake is found. On a fresh chain the first block is backdated, so the tip ends near
  the current time.
- **Chain time runs ahead of the wall clock** once many blocks are mined quickly (60 s per block).
  Derive lock times from the chain tip (`/1/b/best/header`), not the local clock.
- **Soft forks.** CSV, segwit and taproot are `NEVER_ACTIVE` on Reddcoin (mainnet included).
  The compose file activates them on regtest with `-vbparams`, and bootstrap fails unless
  `REQUIRE_DEPLOYMENTS` (default `cltv csv segwit taproot`) are active. Tests that use them
  exercise Reddcoin Core's implementation, not features available on mainnet.
- **Fees.** Reddcoin's relay fee is 100x Bitcoin's. The node runs with
  `-minrelaytxfee=0.00001 -mintxfee=0.00001` so regtest-client's amounts work.
- **Amounts** above 2^53 satoshis (early regtest coinbases pay 545,000,000 RDD) are exact
  internally, and returned as decimal strings in JSON when they don't fit a Number.
- **Ports.** Regtest RPC is 56443 (not 18443).

## Environment

| Variable | Default (image) | |
|---|---|---|
| `RPC` | `http://reddcoind:56443` | Node RPC URL |
| `RPCAUTH` / `RPCCOOKIE` | – | `user:pass`, or a cookie file path |
| `ZMQ` | `tcp://reddcoind:28332` | Node ZMQ endpoint (`-zmqpubhashtx`, `-zmqpubhashblock`) |
| `PORT` | `8080` | |
| `KEYDB` | `/data/KEYS` | API keys, one per line |
| `INDEXDB` | `/data/db` | indexd leveldb directory |
| `BOOTSTRAP_HEIGHT` | `432` | |
| `REQUIRE_DEPLOYMENTS` | `cltv csv segwit taproot` | |

## Publishing

`.github/workflows/on-tag.yml` builds and checks the image on every push. Pushing a `vX.Y.Z` tag also
publishes `reddcoincore/reddcoinjs-regtest-server:vX.Y.Z` (and `latest`) to Docker Hub, using the
`DOCKER_USERNAME` / `DOCKER_TOKEN` organisation secrets.
