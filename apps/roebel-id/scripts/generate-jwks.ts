import { generateKeyPair, exportJWK } from 'jose'

const { privateKey } = await generateKeyPair('RS256', { extractable: true })
const jwk = await exportJWK(privateKey)
jwk.kid = crypto.randomUUID()
jwk.use = 'sig'
jwk.alg = 'RS256'
console.log(JSON.stringify({ keys: [jwk] }))
