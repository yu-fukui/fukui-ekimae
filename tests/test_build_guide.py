import importlib.util
import unittest
from pathlib import Path

_path = Path(__file__).resolve().parent.parent / "scripts" / "build_guide.py"
_spec = importlib.util.spec_from_file_location("build_guide", _path)
build_guide = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_guide)


class RenderTest(unittest.TestCase):
    def test_only_katamachi_night_shops_grouped_and_escaped(self):
        shops = [
            {"slug": "a", "name": "<Bar>", "kana": "ばー", "zone": "katamachi", "genre": "バー", "instagram": "bar_a", "category": "night"},
            {"slug": "b", "name": "スナックB", "kana": "すなっく", "zone": "katamachi", "genre": "スナック・ラウンジ", "category": "night"},
            {"slug": "c", "name": "駅前のバー", "zone": "ekimae", "genre": "バー", "category": "night"},
        ]
        html = build_guide.render(shops)
        self.assertTrue(html.startswith(build_guide.MARK[0]) and html.endswith(build_guide.MARK[1]))
        self.assertIn("いま2軒", html)
        self.assertIn("&lt;Bar&gt;", html)
        self.assertNotIn("駅前のバー", html)
        self.assertLess(html.index("スナック・ラウンジ（1軒）"), html.index("バー（1軒）"))
        self.assertIn('href="/shop/a/"', html)
        self.assertIn("https://www.instagram.com/bar_a/", html)


if __name__ == "__main__":
    unittest.main()
