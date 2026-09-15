// swift-tools-version:5.3
// Local override of https://github.com/ionic-team/capacitor-swift-pm (same package
// identity, same products). Upstream ships Capacitor/Cordova as binary xcframeworks
// with iOS device + simulator slices only, so a Mac Catalyst build of the app fails
// with "no library for this platform was found". The xcframeworks beside this file
// are upstream's iOS slices plus a Mac Catalyst slice built from the identical
// source tag — produced by scripts/build-capacitor-xcframeworks.sh, gitignored.
// Because the directory name matches the remote package's identity, Xcode uses it
// in place of the remote for every package that depends on capacitor-swift-pm
// (CapApp-SPM and each plugin).
import PackageDescription

let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    dependencies: [],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Cordova.xcframework")
    ]
)
