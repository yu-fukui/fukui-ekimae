import importlib.util
import unittest
from datetime import date
from pathlib import Path

spec = importlib.util.spec_from_file_location("compose", Path(__file__).resolve().parent.parent / "scripts/compose.py")
compose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compose)


def shop(slug, category="gourmet", genre="和食", **kw):
    return {"slug": slug, "name": f"店{slug}", "zone": "ekimae", "town": "中央", "category": category,
            "genre": genre, "instagram": kw.pop("instagram", ""), "is_paid": kw.pop("is_paid", False), **kw}


class ComposeTest(unittest.TestCase):
    def test_three_slots_and_mention(self):
        shops = [shop("a", instagram="a_official"), shop("b", genre="居酒屋", instagram="b_ig"), shop("n", "night", "バー", instagram="n_bar")]
        items = compose.compose(date(2026, 10, 10), shops, {"seen": [], "pr_last": {}})
        self.assertEqual([i["scheduled_at"][11:16] for i in items], ["11:30", "17:30", "20:30"])
        self.assertIn("@a_official", items[0]["text"])
        self.assertIn("20歳未満", items[2]["text"])

    def test_paid_shop_gets_pr_once_per_30_days(self):
        shops = [shop("a", instagram="a_ig"), shop("p", is_paid=True, catch="駅前の老舗"), shop("n", "night", "バー", instagram="n_ig")]
        featured = {"seen": [], "pr_last": {}}
        first = compose.compose(date(2026, 10, 10), shops, featured)
        self.assertTrue(first[1]["text"].startswith("【PR】"))
        self.assertIn("駅前の老舗", first[1]["text"])
        again = compose.compose(date(2026, 10, 20), shops, featured)
        self.assertFalse(any(i["text"].startswith("【PR】") for i in again))
        later = compose.compose(date(2026, 11, 9), shops, featured)
        self.assertTrue(any(i["text"].startswith("【PR】") for i in later))

    def test_no_repeat_until_all_shown(self):
        shops = [shop(str(i), instagram=f"ig{i}") for i in range(3)] + [shop("n", "night", "バー", instagram="n_ig")]
        featured = {"seen": [], "pr_last": {}}
        lunch = [compose.compose(date(2026, 10, d), shops, featured)[0]["text"] for d in (1, 2, 3)]
        self.assertEqual(len(set(lunch)), 3)

    def test_only_shops_with_instagram(self):
        shops = [shop("noig"), shop("ig", instagram="ig_ok"), shop("n0", "night", "バー"), shop("n1", "night", "バー", instagram="bar_ok")]
        for d in range(1, 6):
            items = compose.compose(date(2026, 10, d), shops, {"seen": [], "pr_last": {}})
            text = "\n".join(i["text"] for i in items)
            self.assertNotIn("店noig", text)
            self.assertNotIn("店n0", text)

    def test_shared_account_is_later_and_not_mentioned(self):
        shops = [shop("own", instagram="own_ig"), shop("chain", instagram="chain_hq", instagram_shared=True), shop("n", "night", "バー", instagram="n_ig")]
        featured = {"seen": [], "pr_last": {}}
        first = compose.compose(date(2026, 10, 1), shops, featured)[0]["text"]
        self.assertIn("店own", first)
        second = compose.compose(date(2026, 10, 2), shops, featured)[0]["text"]
        self.assertIn("店chain", second)
        self.assertNotIn("@chain_hq", second)


if __name__ == "__main__":
    unittest.main()
