import pkg from '../../package.json'

export const APP_VERSION = pkg.version

// UI label: "v0.0.4" from "0.0.4". We render the full semver because the
// 0.0.x series would otherwise all collapse to "v0.0". Help anchors
// (e.g. `help-release-0-3`) are deliberately frozen per release and not
// derived from this.
export const APP_VERSION_SHORT = `v${pkg.version}`
