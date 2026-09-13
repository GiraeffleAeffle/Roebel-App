import { loadConfig } from './config.js'
import { wireApp } from './wire.js'
import { loadStagingConfig, wireStagingApp } from './staging.js'

const profile = process.env.ROEBEL_ID_DEPLOYMENT_PROFILE
if (profile && profile !== 'staging-synthetic') throw new Error('Unknown identity deployment profile')
const stagingConfig = profile === 'staging-synthetic' ? loadStagingConfig() : undefined
const config = stagingConfig ?? loadConfig()
const { app } = stagingConfig ? wireStagingApp(stagingConfig) : wireApp(config)
app.listen(config.port, () => { console.log(`roebel-id listening on ${config.port}`) })
