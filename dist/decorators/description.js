"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const namespace_1 = require("./namespace");
function Description(str) {
    return target => {
        Reflect.defineMetadata(namespace_1.default.RPC_DESCRIPTION, str, target);
    };
}
exports.default = Description;
