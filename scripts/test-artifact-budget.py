import importlib.util
from pathlib import Path
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('budget', Path(__file__).with_name('check-artifact-budget.py'))
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)
class BudgetTests(unittest.TestCase):
    def test_payload_boundary_and_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            item = root / 'evidence.bin'
            item.write_bytes(b'evidence')
            count, size = budget.check([root, item, root / 'missing'])
            self.assertEqual(count, 1)
            self.assertEqual(budget.check([root], max_bytes=size), (count, size))
            with self.assertRaises(ValueError):
                budget.check([root], max_bytes=size - 1)
            self.assertEqual(item.read_bytes(), b'evidence')
    def test_hidden_files_and_count(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / '.hidden').write_text('included')
            (root / 'visible').write_text('included')
            self.assertEqual(budget.check([root])[0], 2)
            with self.assertRaises(ValueError):
                budget.check([root], max_files=1)
    def test_symlink_and_parent_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / 'target'
            target.mkdir()
            (target / 'item').write_text('untouched')
            link = root / 'link'
            link.symlink_to(target, target_is_directory=True)
            for path in [link, link / 'item']:
                with self.assertRaises(ValueError):
                    budget.check([path])
            self.assertEqual((target / 'item').read_text(), 'untouched')
if __name__ == '__main__':
    unittest.main()
