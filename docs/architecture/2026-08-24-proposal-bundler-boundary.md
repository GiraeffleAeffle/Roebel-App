# Proposal Bundler Boundary (staging / not deployed)

`/api/bundler` is an optional high-gas, self-paying ERC-4337 transport for the
existing administrator dashboard proposal flow. It is not a general RPC proxy,
wallet, signer, paymaster, governance authority, or public endpoint.

It is closed unless all of these are true:

- the reviewed server configuration is exactly a Pimlico Gnosis chain-100 URL
  with one server-only `apikey` parameter _and_ the exact current Gnosis MACI
  Governor address;
- the browser sends a same-origin request with a valid signed dashboard
  session; and
- the request fits the exact bounded JSON-RPC schema: chain/entry-point/gas
  discovery, user-operation estimate/send/receipt lookup, an approved Gnosis
  EntryPoint, an existing self-paying account, no factory deployment, and no
  paymaster. Estimate/send must carry canonical
  `execute(address,uint256,bytes)` calldata with zero value, the reviewed
  Governor as target, and a
  `proposeWithPeriod(address[],uint256[],bytes[],string,uint32)` inner
  selector with a canonical, contract-bounded (one hour to 30 days) period.
  Other smart-account calls cannot reach Pimlico.

The route has a 64 KiB body limit, five-second request-read timeout,
eight-second upstream timeout, eight active requests per process, and a
per-dashboard-session 24 requests/minute budget. It forwards no client headers
or credentials, follows no redirects, and exposes neither upstream failures
nor error bodies. It accepts only well-formed JSON results whose request ID
matches; upstream error text is not reflected.

The Governor contract still decides whether the account is an attester and
whether a proposal is valid. The proxy never signs, sponsors, changes a chain,
or lifts that authorization boundary. It remains behind the reviewed ingress
boundary; this code alone does not enable it or deploy it.
