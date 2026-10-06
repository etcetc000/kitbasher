/* The NRV2B packer the engine needs, as three exports for WebAssembly: UCL 1.03's
   ucl_nrv2b_99_compress (the packer whose level 10 reproduces Elektron's OS slots byte for byte)
   and ucl_nrv2b_decompress_8 for the round-trip check. */
#include <stdlib.h>
#include <ucl/ucl.h>

int md_init(void) { return ucl_init() == UCL_E_OK ? 0 : -1; }

/* returns the packed length, or a negative UCL error */
long md_pack(const unsigned char *in, unsigned long n, unsigned char *out, int level)
{
    ucl_uint outlen = 0;
    int r = ucl_nrv2b_99_compress(in, n, out, &outlen, NULL, level, NULL, NULL);
    return r == UCL_E_OK ? (long)outlen : (long)r;
}

/* returns the unpacked length, or a negative UCL error */
long md_unpack(const unsigned char *in, unsigned long n, unsigned char *out, unsigned long cap)
{
    ucl_uint back = cap;
    int r = ucl_nrv2b_decompress_8(in, n, out, &back, NULL);
    return r == UCL_E_OK ? (long)back : (long)r;
}
