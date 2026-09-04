const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function setPlistValue(plistPath, key, value) {
  execFileSync('/usr/libexec/PlistBuddy', [
    '-c',
    `Set :${key} ${value}`,
    plistPath,
  ])
}

exports.default = async function restoreElectronHelperNames({ appOutDir, packager }) {
  if (packager.platform.name !== 'mac') return

  const product = packager.appInfo.productFilename
  const frameworksDir = path.join(
    appOutDir,
    `${product}.app`,
    'Contents',
    'Frameworks',
  )

  for (const suffix of ['', ' (GPU)', ' (Plugin)', ' (Renderer)']) {
    const packagedName = `${product} Helper${suffix}`
    const electronName = `Electron Helper${suffix}`
    const packagedBundle = path.join(frameworksDir, `${packagedName}.app`)
    const electronBundle = path.join(frameworksDir, `${electronName}.app`)

    if (!fs.existsSync(packagedBundle) || fs.existsSync(electronBundle)) continue

    fs.renameSync(packagedBundle, electronBundle)

    const macOSDir = path.join(electronBundle, 'Contents', 'MacOS')
    const packagedExecutable = path.join(macOSDir, packagedName)
    const electronExecutable = path.join(macOSDir, electronName)
    if (fs.existsSync(packagedExecutable)) {
      fs.renameSync(packagedExecutable, electronExecutable)
    }

    const plistPath = path.join(electronBundle, 'Contents', 'Info.plist')
    setPlistValue(plistPath, 'CFBundleExecutable', electronName)
    setPlistValue(plistPath, 'CFBundleName', electronName)
  }
}
