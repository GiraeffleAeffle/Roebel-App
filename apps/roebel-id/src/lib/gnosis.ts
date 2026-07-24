import { createPublicClient, http, type PublicClient } from 'viem'
import { gnosis } from 'viem/chains'
import type { Config } from '../config.js'

export type SignatureVerifier = (a: {
  address: `0x${string}`; message: string; signature: `0x${string}`
}) => Promise<boolean>

// viem's verifyMessage validates EOAs, deployed ERC-1271 accounts, and undeployed
// ERC-6492 accounts — exactly what we need for thirdweb smart accounts on Gnosis.
export function createGnosisVerifier(config: Config): SignatureVerifier {
  const client: PublicClient = createPublicClient({ chain: gnosis, transport: http(config.gnosisRpcUrl) })
  return ({ address, message, signature }) => client.verifyMessage({ address, message, signature })
}
