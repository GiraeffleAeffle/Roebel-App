import { loadConfig } from './config.js'
import { wireApp } from './wire.js'

const config = loadConfig()
const { app } = wireApp(config)
app.listen(config.port, () => { console.log(`roebel-id listening on ${config.port}`) })
