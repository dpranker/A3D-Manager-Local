import importlib.util
from pathlib import Path
import tempfile
import unittest
import zlib

spec = importlib.util.spec_from_file_location('rom_import', Path(__file__).resolve().parents[2] / 'scripts/import-rom-cart-ids.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RomCartIds(unittest.TestCase):
    def test_byte_orders_produce_identical_hash(self):
        data = bytearray((i % 256 for i in range(8192)))
        data[:4] = bytes.fromhex('80371240')
        expected = bytes(data)
        for width in (2, 4):
            swapped = b''.join(expected[i:i+width][::-1] for i in range(0, len(expected), width))
            self.assertEqual(module.normalize(swapped), expected)
        self.assertEqual(module.normalize(expected), expected)

    def test_invalid_and_short_roms_are_rejected(self):
        for data in (b'', b'\0' * 8192):
            with self.assertRaises(ValueError):
                module.normalize(data)

    def test_hash_uses_first_8k_and_market_and_revision_survive(self):
        data = bytearray(8192)
        data[:4] = bytes.fromhex('80371240')
        data[0x3b:0x40] = b'NNSX\x01'
        with tempfile.TemporaryDirectory() as temp:
            filename = Path(temp) / 'HSV Adventure Racing! (Australia) (Rev 1).z64'
            filename.write_bytes(data + b'Ignored payload')
            cart = module.read_cart(filename)
        self.assertEqual(cart['id'], f'{zlib.crc32(data):08x}')
        self.assertEqual(cart['region'], 'Australia')
        self.assertEqual(cart['videoMode'], 'PAL')
        self.assertEqual(cart['revision'], 1)
        self.assertEqual(cart['gameCode'], 'NNSX')


if __name__ == '__main__':
    unittest.main()
