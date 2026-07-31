// Main authenticated layout: sidebar navigation + header + content outlet.
import { Layout, Menu, Avatar, Dropdown, Typography, theme } from "antd";
import {
  DashboardOutlined,
  FileTextOutlined,
  TeamOutlined,
  ApartmentOutlined,
  SolutionOutlined,
  DeploymentUnitOutlined,
  LogoutOutlined,
  UserOutlined,
  UsergroupAddOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Suspense } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store";
import { logout, sessionCleared } from "@/store/authSlice";
import RouteFallback from "@/components/RouteFallback";
import ThemeToggle from "@/components/ThemeToggle";
import { useThemeMode } from "@/theme/ThemeProvider";

const { Header, Sider, Content } = Layout;

// Navigation items with their routes (labels in French).
const NAV = [
  { key: "/dashboard", icon: <DashboardOutlined />, label: "Tableau de bord" },
  { key: "/candidatures", icon: <FileTextOutlined />, label: "Candidatures" },
  { key: "/candidats", icon: <TeamOutlined />, label: "Candidats" },
  { key: "/departements", icon: <ApartmentOutlined />, label: "Départements" },
  { key: "/offres", icon: <SolutionOutlined />, label: "Offres de stage" },
  { key: "/matching", icon: <DeploymentUnitOutlined />, label: "Affectation IA" },
  { key: "/assistant", icon: <RobotOutlined />, label: "Assistant RAG" },
];
// Admin-only navigation item (user management).
const ADMIN_NAV = { key: "/utilisateurs", icon: <UsergroupAddOutlined />, label: "Utilisateurs" };

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const navItems = user?.role === "admin" ? [...NAV, ADMIN_NAV] : NAV;
  const { mode } = useThemeMode();
  const { token } = theme.useToken();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        breakpoint="lg"
        collapsedWidth="0"
        theme={mode}
        style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
      >
        <div
          style={{
            color: token.colorPrimary,
            padding: "18px 16px",
            fontWeight: 700,
            fontSize: 16,
            lineHeight: 1.3,
          }}
        >
          PHOSBOUCRAA
          <div style={{ fontSize: 11, color: token.colorTextSecondary, fontWeight: 400 }}>
            Assistant IA Stages
          </div>
        </div>
        <Menu
          theme={mode}
          mode="inline"
          selectedKeys={[location.pathname]}
          items={navItems}
          onClick={(e) => navigate(e.key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "transparent",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 8,
            paddingInline: 24,
          }}
        >
          <ThemeToggle />
          <Dropdown
            menu={{
              items: [
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "Se déconnecter",
                  onClick: () => {
                    dispatch(sessionCleared()); // instant UI logout
                    dispatch(logout()); // background Supabase sign-out
                    navigate("/login");
                  },
                },
              ],
            }}
          >
            <div style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
              <Avatar icon={<UserOutlined />} style={{ background: token.colorPrimary }} />
              <Typography.Text>{user?.full_name ?? "Utilisateur"}</Typography.Text>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24 }}>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
