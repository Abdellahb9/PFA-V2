// Dark / light NVIDIA theme switch.
import { Button, Tooltip, theme } from "antd";
import { BulbFilled, BulbOutlined } from "@ant-design/icons";
import { useThemeMode } from "@/theme/ThemeProvider";

export default function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  const { token } = theme.useToken();
  const toLight = mode === "dark";
  return (
    <Tooltip title={toLight ? "Passer en clair" : "Passer en sombre"}>
      <Button
        type="text"
        shape="circle"
        aria-label="Changer de thème (clair / sombre)"
        icon={toLight ? <BulbFilled style={{ color: token.colorPrimary }} /> : <BulbOutlined />}
        onClick={toggle}
      />
    </Tooltip>
  );
}
