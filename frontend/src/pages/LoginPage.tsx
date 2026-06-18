// Login page with React Hook Form + Zod validation.
// AntD inputs are controlled components, so they are wired through RHF's
// <Controller> (spreading register() does not capture their value/ref).
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Card, Form, Input, Typography, Alert } from "antd";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store";
import { login } from "@/store/authSlice";

const schema = z.object({
  email: z.string().email("Adresse email invalide"),
  password: z.string().min(4, "Mot de passe requis"),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isAuthenticated, loading, error } = useAppSelector((s) => s.auth);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (values: FormValues) => {
    const result = await dispatch(login(values));
    if (login.fulfilled.match(result)) navigate("/dashboard");
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #00843d 0%, #024d24 100%)",
      }}
    >
      <Card className="login-card">
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>
            Assistant IA
          </Typography.Title>
          <Typography.Text type="secondary">
            Gestion des stages — PHOSBOUCRAA
          </Typography.Text>
        </div>

        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

        <Form layout="vertical" onFinish={handleSubmit(onSubmit)}>
          <Form.Item
            label="Email"
            validateStatus={errors.email ? "error" : ""}
            help={errors.email?.message}
          >
            <Controller
              name="email"
              control={control}
              render={({ field }) => (
                <Input {...field} placeholder="admin@phosboucraa.ma" autoComplete="username" />
              )}
            />
          </Form.Item>
          <Form.Item
            label="Mot de passe"
            validateStatus={errors.password ? "error" : ""}
            help={errors.password?.message}
          >
            <Controller
              name="password"
              control={control}
              render={({ field }) => (
                <Input.Password
                  {...field}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              )}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            Se connecter
          </Button>
        </Form>
      </Card>
    </div>
  );
}
