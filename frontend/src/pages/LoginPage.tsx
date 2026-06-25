// Login page with React Hook Form + Zod validation.
// AntD inputs are controlled components, so they are wired through RHF's
// <Controller> (spreading register() does not capture their value/ref).
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Card, Form, Input, Typography, Alert } from "antd";
import { Navigate, useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/store";
import { login, isStaff } from "@/store/authSlice";

const schema = z.object({
  email: z.string().email("Adresse email invalide"),
  password: z.string().min(4, "Mot de passe requis"),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isAuthenticated, user, loading, error } = useAppSelector((s) => s.auth);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  if (isAuthenticated) {
    return <Navigate to={isStaff(user?.role) ? "/dashboard" : "/mon-espace"} replace />;
  }

  const onSubmit = async (values: FormValues) => {
    const result = await dispatch(login(values));
    if (login.fulfilled.match(result)) {
      navigate(isStaff(result.payload.role) ? "/dashboard" : "/mon-espace");
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 50% -10%, rgba(118,185,0,0.18) 0%, #0A0A0A 55%)",
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

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Typography.Text type="secondary">Vous êtes candidat ? </Typography.Text>
          <Link to="/inscription">Créer un compte</Link>
        </div>
      </Card>
    </div>
  );
}
