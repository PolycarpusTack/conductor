import pkg from '../../package.json'

export const APP_VERSION = pkg.version

// UI short form: "v0.3" from "0.3.0". Help anchors (e.g. `help-release-0-3`)
// are deliberately frozen per release, so they are not derived from this.
const [major = '0', minor = '0'] = pkg.version.split('.')
export const APP_VERSION_SHORT = `v${major}.${minor}`
