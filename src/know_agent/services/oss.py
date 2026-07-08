"""对象存储服务 — RustFS (S3 兼容, boto3).

对应源项目 common/service/OssService + common/config/RustFsConfiguration.
"""

import json
from urllib.parse import urlparse

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from know_agent.configuration import get_settings

# RustFS / MinIO 默认 S3 端口（与源项目 application.yaml 一致）
_DEFAULT_S3_PORT = 9000


def _normalize_endpoint(endpoint: str | None) -> str:
    """归一化 S3 endpoint：补 scheme（默认 http），缺端口时补默认端口."""
    if not endpoint:
        return ""
    if "://" not in endpoint:
        endpoint = f"http://{endpoint}"
    p = urlparse(endpoint)
    if p.port is None:
        endpoint = f"{p.scheme}://{p.hostname}:{_DEFAULT_S3_PORT}"
    return endpoint


class OssService:
    def __init__(self) -> None:
        s = get_settings()
        self.endpoint = _normalize_endpoint(s.s3_endpoint)
        self.bucket = s.s3_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=s.s3_access_key,
            aws_secret_access_key=s.s3_secret_key,
            region_name=s.s3_region,
            # RustFS / 自建 S3 需 path style
            config=Config(s3={"addressing_style": "path"}),
        )

    def _ensure_bucket(self, public_read: bool = True) -> None:
        try:
            self._client.head_bucket(Bucket=self.bucket)
        except ClientError:
            self._client.create_bucket(Bucket=self.bucket)
            if public_read:
                policy = {
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Effect": "Allow",
                            "Principal": {"AWS": ["*"]},
                            "Action": ["s3:GetObject"],
                            "Resource": [f"arn:aws:s3:::{self.bucket}/*"],
                        }
                    ],
                }
                self._client.put_bucket_policy(
                    Bucket=self.bucket, Policy=json.dumps(policy)
                )

    def _public_url(self, object_name: str) -> str:
        return f"{self.endpoint}/{self.bucket}/{object_name}"

    def upload_bytes(
        self, data: bytes, object_name: str, content_type: str | None = None
    ) -> str:
        """上传字节内容，返回公共访问 URL."""
        self._ensure_bucket(public_read=True)
        extra = {"ContentType": content_type} if content_type else {}
        self._client.put_object(
            Bucket=self.bucket, Key=object_name, Body=data, **extra
        )
        return self._public_url(object_name)

    def upload_fileobj(
        self, fileobj, object_name: str, content_type: str | None = None
    ) -> str:
        """上传文件流，返回公共访问 URL."""
        self._ensure_bucket(public_read=True)
        extra = {"ContentType": content_type} if content_type else {}
        self._client.upload_fileobj(
            Fileobj=fileobj, Bucket=self.bucket, Key=object_name, ExtraArgs=extra
        )
        return self._public_url(object_name)

    def download(self, object_name: str):
        """下载文件，返回 StreamingBody（类似 Java InputStream）."""
        r = self._client.get_object(Bucket=self.bucket, Key=object_name)
        return r["Body"]

    def delete(self, object_name: str) -> None:
        self._client.delete_object(Bucket=self.bucket, Key=object_name)


_oss: OssService | None = None


def get_oss() -> OssService:
    global _oss
    if _oss is None:
        _oss = OssService()
    return _oss
