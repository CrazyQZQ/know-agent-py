"""graphs 包入口 - 扫描子包触发各 graph 模块的 register_graph 自登记.

类似 Java @ComponentScan：import 本包即自动发现并注册所有 graph。
循环 import 分析：先 import registry 再扫描，子模块 import 时 registry 已就绪。
"""

from know_agent.graphs import registry  # noqa: F401  先就绪 registry

import importlib
import pkgutil

for _finder, _modname, _ispkg in pkgutil.walk_packages(__path__, prefix=__name__ + "."):
    importlib.import_module(_modname)
