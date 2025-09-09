import importlib
import io
import json
import os
import sys
from pathlib import Path

# プロジェクトのルートディレクトリをsys.pathに追加して、lambdaモジュールをインポートできるようにする
sys.path.append(str(Path(__file__).parent.parent))

import pytest
from PIL import Image

# テスト用の画像ファイルのパスを設定
# __file__ はこのファイルのパス、.parent は親ディレクトリ(tests/)
# .parent.joinpath("tests/assets") で tests/assets ディレクトリへのパスを構築
ASSETS_DIR = Path(__file__).parent.joinpath("assets")
IMAGE_PATHS = [
    ASSETS_DIR / "image.jpg",
    ASSETS_DIR / "image.png",
    ASSETS_DIR / "image.webp",
]

# テスト用のnanoid (8文字でBCH_5対応)
TEST_POST_ID = "abc12345"


# parametrizeデコレータで、3つの画像パスそれぞれに対してテストを実行
@pytest.mark.parametrize("image_path", IMAGE_PATHS)
def test_embed_and_extract_watermark(image_path):
    """
    電子透かしの埋め込みと抽出が正常に行えるかをテストする。
    Test A: embed_watermark_to_image_data
    Test B: extract_nano_id_from_watermark
    """
    # 動的インポートでSyntaxErrorを回避
    embed_module = importlib.import_module("lambda.batch.embed_watermark")
    embed_watermark_to_image_data = embed_module.embed_watermark_to_image_data
    verify_module = importlib.import_module("lambda.verify_watermark.handler")
    extract_nano_id_from_watermark = verify_module.extract_nano_id_from_watermark
    # --- テスト準備 ---
    assert image_path.exists(), f"テスト画像が見つかりません: {image_path}"

    # 元の画像データを読み込む
    with open(image_path, "rb") as f:
        original_image_data = f.read()

    # すべての画像をPNG形式に変換してテストの一貫性を保つ
    with Image.open(image_path).convert("RGB") as img:
        with io.BytesIO() as output:
            img.save(output, format="PNG")
            original_image_data = output.getvalue()

    # --- テストA: 電子透かしの埋め込み ---
    # 新しい仕様では Post IDを直接渡す
    watermarked_image_data = embed_watermark_to_image_data(
        original_image_data, TEST_POST_ID
    )

    # アサーション: 埋め込み後のデータが元のデータと異なることを確認
    assert watermarked_image_data is not None
    assert original_image_data != watermarked_image_data

    # --- テストB: 電子透かしの抽出 ---
    extraction_result = extract_nano_id_from_watermark(watermarked_image_data)

    # アサーション: 抽出結果の検証
    assert extraction_result is not None
    assert extraction_result["method"] == "trustmark_P_BCH5"
    assert extraction_result["confidence"] > 0.9  # 高い信頼度で抽出できることを確認
    # trustmarkにはnanoidが直接格納される
    expected_id = TEST_POST_ID
    assert extraction_result["extractedId"].strip() == expected_id
