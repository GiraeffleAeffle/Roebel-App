import { loadConfig } from './config.js'
import { createApp } from './app.js'

const config = loadConfig()
const app = createApp()
app.listen(config.port, () => { console.log(`roebel-id listening on ${config.port}`) })
