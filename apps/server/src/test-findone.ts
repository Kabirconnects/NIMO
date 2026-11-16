import mongoose from "mongoose";
const s = new mongoose.Schema({ x: String }, { timestamps: true });
const M = mongoose.model("T2", s);
const r = M.findOne({}, {});
console.log(r);
