import type { ReactNode } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { XProvider } from "@ant-design/x";
import zhCNX from "@ant-design/x/locale/zh_CN";

import { useThemeValue } from "@/hooks/useTheme";

// antd token 映射到现有 shadcn HSL CSS 变量。color 类 token 用 hsl(var(...))
// 字符串，运行时随 .dark class 切换自动跟随；algorithm 负责 dark 明暗反转。
// borderRadius 是 number token，与 --radius (0.4375rem ≈ 7px) 对齐。
const sharedToken = {
  colorPrimary: "hsl(var(--primary))",
  colorBgContainer: "hsl(var(--card))",
  colorBgElevated: "hsl(var(--popover))",
  colorBgSpotlight: "hsl(var(--popover))",
  colorText: "hsl(var(--foreground))",
  colorTextSecondary: "hsl(var(--muted-foreground))",
  colorBorder: "hsl(var(--border))",
  colorBgLayout: "hsl(var(--background))",
  borderRadius: 7,
};

export function RootProviders({ children }: { children: ReactNode }) {
  const theme = useThemeValue();
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        algorithm:
          theme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: {},
        token: sharedToken,
        components: {
          Select: {
            optionSelectedBg: "hsl(var(--accent))",
            optionSelectedColor: "hsl(var(--foreground))",
            optionActiveBg: "hsl(var(--accent))",
          },
        },
      }}
    >
      <XProvider locale={zhCNX}>{children}</XProvider>
    </ConfigProvider>
  );
}
