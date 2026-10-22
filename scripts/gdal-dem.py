"""Thin binding to GDAL's public DEMProcessing C API shipped with Rasterio.

No slope algorithm is implemented here. This avoids compiling a second GDAL
installation just to obtain the optional osgeo Python bindings.
"""
import ctypes as c
from pathlib import Path
import rasterio


def slope(source, destination):
    package = Path(rasterio.__file__).parent
    candidates = list((package / '.dylibs').glob('libgdal*.dylib')) + list((package.parent / 'rasterio.libs').glob('libgdal*.so*'))
    if len(candidates) != 1:
        raise RuntimeError('Expected Rasterio wheel bundled GDAL library')
    lib = c.CDLL(str(candidates[0]))
    signatures = {
        'GDALAllRegister': (None, []), 'GDALOpen': (c.c_void_p, [c.c_char_p, c.c_int]),
        'GDALClose': (c.c_int, [c.c_void_p]),
        'GDALDEMProcessingOptionsNew': (c.c_void_p, [c.POINTER(c.c_char_p), c.c_void_p]),
        'GDALDEMProcessingOptionsFree': (None, [c.c_void_p]),
        'GDALDEMProcessing': (c.c_void_p, [c.c_char_p, c.c_void_p, c.c_char_p, c.c_char_p, c.c_void_p, c.POINTER(c.c_int)]),
    }
    for name, (result, args) in signatures.items():
        fn = getattr(lib, name); fn.restype, fn.argtypes = result, args
    lib.GDALAllRegister()
    # No -compute_edges: require every neighbor, preserving NoData holes.
    options = [b'-alg', b'Horn', b'-s', b'1', b'-of', b'GTiff', b'-co', b'TILED=YES', b'-co', b'COMPRESS=DEFLATE']
    argv = (c.c_char_p * (len(options) + 1))(*options, None)
    config = lib.GDALDEMProcessingOptionsNew(argv, None)
    src, output = None, None
    try:
        src = lib.GDALOpen(str(source).encode(), 0)
        if not src or not config: raise RuntimeError('GDAL input/options unavailable')
        error = c.c_int()
        output = lib.GDALDEMProcessing(str(destination).encode(), src, b'slope', None, config, c.byref(error))
        if not output or error.value: raise RuntimeError('GDAL slope generation failed')
    finally:
        if output: lib.GDALClose(output)
        if src: lib.GDALClose(src)
        if config: lib.GDALDEMProcessingOptionsFree(config)
