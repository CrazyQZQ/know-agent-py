"""PPT 渲染服务 — 对应源项目 PptPythonRenderService.

调用 scripts/render_ppt.py 子进程渲染 PPT，上传结果到 RustFS。
"""

import os
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from loguru import logger

from know_agent.services.oss import get_oss

# render_ppt.py 位置：项目根/scripts/render_ppt.py
_RENDER_SCRIPT = Path(__file__).resolve().parents[4] / "scripts" / "render_ppt.py"
_PPT_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _extract_object_name(url: str) -> str:
    """从 OSS 公共 URL 提取 object name."""
    from know_agent.configuration import get_settings

    bucket = get_settings().s3_bucket or ""
    idx = url.rfind(bucket)
    if idx == -1:
        return url.rsplit("/", 1)[-1]
    start = idx + len(bucket) + 1
    return url[start:] if start < len(url) else ""


def _resolve_object_name(template_url: str) -> str:
    """template_url 可能是相对路径（ppt-templates/ai.pptx）或 OSS 公共 URL."""
    if "://" in template_url:
        return _extract_object_name(template_url)
    return template_url


def render_ppt(conversation_id: str, template_url: str, ppt_schema: str) -> str:
    """渲染 PPT 并上传到 OSS，返回公共 URL."""
    oss = get_oss()

    # 1. 下载模板到本地临时文件
    object_name = _resolve_object_name(template_url)
    logger.info("render_ppt: download template object={}", object_name)
    template_data = oss.download(object_name).read()
    with tempfile.NamedTemporaryFile(suffix=".pptx", delete=False) as tf:
        tf.write(template_data)
        template_path = tf.name

    # 2. 输出路径
    output_dir = Path("output/ppt")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / f"ppt_{datetime.now().strftime('%Y%m%d%H%M%S')}.pptx"

    # 3. 构建环境（schema 通过环境变量传递，>20KB 用临时文件）
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    schema_tempfile = None
    if len(ppt_schema) > 20000:
        schema_tempfile = tempfile.NamedTemporaryFile(
            suffix=".json", delete=False, mode="w", encoding="utf-8"
        )
        schema_tempfile.write(ppt_schema)
        schema_tempfile.close()
        env["PPT_SCHEMA_FILE"] = schema_tempfile.name
    else:
        env["PPT_SCHEMA"] = ppt_schema

    # 4. 执行 render_ppt.py
    cmd = [
        sys.executable,
        str(_RENDER_SCRIPT),
        "--template", template_path,
        "--output", str(output_file),
    ]
    logger.info("render_ppt: {}", " ".join(cmd))
    result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        logger.error("render_ppt failed: {}", result.stderr[:500])
        raise RuntimeError(f"render_ppt 执行失败: {result.stderr[:500]}")

    # 5. 上传到 OSS
    file_bytes = output_file.read_bytes()
    obj_name = f"ppt/{conversation_id}/{output_file.name}"
    file_url = oss.upload_bytes(file_bytes, obj_name, _PPT_MIME)
    logger.info("PPT uploaded: {}", file_url)

    # 6. 清理本地文件
    output_file.unlink(missing_ok=True)
    Path(template_path).unlink(missing_ok=True)
    if schema_tempfile:
        Path(schema_tempfile.name).unlink(missing_ok=True)

    return file_url
