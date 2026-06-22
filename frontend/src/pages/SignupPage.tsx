// Candidate sign-up (Supabase Auth). New accounts default to the 'candidate'
// role; existing anonymous applications with the same email get auto-linked.
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Card, Form, Input, Result, Typography, message } from "antd";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAppDispatch, useAppSelector } from "@/store";
import { fetchMe } from "@/store/authSlice";

const schema = z.object({
  full_name: z.string().min(1, "Nom complet requis"),
  email: z.string().email("Adresse email invalide"),
  password: z.string().min(6, "6 caractères minimum"),
});
type FormValues = z.infer<typeof schema>;

export default function SignupPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isAuthenticated } = useAppSelector((s) => s.auth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", password: "" },
  });

  if (isAuthenticated) return <Navigate to="/mon-espace" replace />;

  const onSubmit = async (values: FormValues) => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { full_name: values.full_name } },
    });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    if (data.session) {
      await dispatch(fetchMe());
      message.success("Compte créé !");
      navigate("/mon-espace");
    } else {
      // Email confirmation is enabled on the project.
      setConfirmPending(true);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #00843d 0%, #024d24 100%)",
        padding: 24,
      }}
    >
      <Card className="login-card">
        {confirmPending ? (
          <Result
            status="success"
            title="Compte créé"
            subTitle="Vérifiez votre boîte mail pour confirmer votre compte, puis connectez-vous."
            extra={
              <Button type="primary" onClick={() => navigate("/login")}>
                Aller à la connexion
              </Button>
            }
          />
        ) : (
          <>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <Typography.Title level={3} style={{ marginBottom: 0 }}>
                Créer un compte
              </Typography.Title>
              <Typography.Text type="secondary">
                Suivez l'avancement de vos candidatures
              </Typography.Text>
            </div>

            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

            <Form layout="vertical" onFinish={handleSubmit(onSubmit)}>
              <Form.Item
                label="Nom complet"
                validateStatus={errors.full_name ? "error" : ""}
                help={errors.full_name?.message}
              >
                <Controller
                  name="full_name"
                  control={control}
                  render={({ field }) => <Input {...field} placeholder="Youssef El Khattabi" />}
                />
              </Form.Item>
              <Form.Item
                label="Email"
                validateStatus={errors.email ? "error" : ""}
                help={errors.email?.message}
              >
                <Controller
                  name="email"
                  control={control}
                  render={({ field }) => (
                    <Input {...field} placeholder="vous@example.ma" autoComplete="email" />
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
                    <Input.Password {...field} autoComplete="new-password" placeholder="••••••••" />
                  )}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading}>
                Créer mon compte
              </Button>
            </Form>

            <div style={{ textAlign: "center", marginTop: 16 }}>
              <Typography.Text type="secondary">Déjà un compte ? </Typography.Text>
              <Link to="/login">Se connecter</Link>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
