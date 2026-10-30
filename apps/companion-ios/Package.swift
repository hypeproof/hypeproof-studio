// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "CompanionCore", platforms: [.macOS(.v13), .iOS(.v16)],
    products: [.library(name: "CompanionCore", targets: ["CompanionCore"])],
    targets: [.target(name: "CompanionCore")])
