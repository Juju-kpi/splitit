#!/usr/bin/env python3
"""Export the fine-tuned model to ONNX + int8 quantization for transformers.js.

transformers.js (@huggingface/transformers) loads models from a directory that
contains an `onnx/` folder with quantized weights. This produces exactly that
layout so the Node backend can run the model on CPU with no Python at runtime.

Env:
  MODEL_DIR  default out/model      (input: the fine-tuned HF model)
  ONNX_DIR   default out/onnx-model (output: transformers.js-ready folder)
"""
import os, shutil, pathlib
from optimum.onnxruntime import ORTModelForSeq2SeqLM, ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from transformers import AutoTokenizer

MODEL_DIR = os.environ.get("MODEL_DIR", "out/model")
ONNX_DIR = os.environ.get("ONNX_DIR", "out/onnx-model")

def main() -> None:
    out = pathlib.Path(ONNX_DIR)
    onnx_sub = out / "onnx"
    onnx_sub.mkdir(parents=True, exist_ok=True)

    # 1. Export encoder/decoder to ONNX.
    model = ORTModelForSeq2SeqLM.from_pretrained(MODEL_DIR, export=True)
    model.save_pretrained(out)
    AutoTokenizer.from_pretrained(MODEL_DIR).save_pretrained(out)

    # 2. Dynamic int8 quantization of each ONNX graph (smaller + faster on CPU).
    qconfig = AutoQuantizationConfig.avx2(is_static=False, per_channel=False)
    for onnx_file in out.glob("*.onnx"):
        quantizer = ORTQuantizer.from_pretrained(out, file_name=onnx_file.name)
        quantizer.quantize(save_dir=out, quantization_config=qconfig)

    # 3. transformers.js expects the ONNX graphs under an `onnx/` subfolder,
    #    with `_quantized` suffix so it picks the int8 variant.
    for f in out.glob("*_quantized.onnx"):
        shutil.move(str(f), str(onnx_sub / f.name.replace("_quantized", "_quantized")))
    for f in list(out.glob("*.onnx")):
        # keep an fp32 copy too (transformers.js can pick either)
        shutil.move(str(f), str(onnx_sub / f.name))

    print(f"ONNX model ready at {out} (quantized graphs in {onnx_sub}).")

if __name__ == "__main__":
    main()
