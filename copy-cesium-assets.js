const fs = require("fs-extra");
const path = require("path");

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumDest = "public/cesium";

fs.copySync(cesiumSource, cesiumDest);