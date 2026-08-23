// Cloche de notifications : signale les candidats arrivés depuis la dernière
// consultation. Le repère « déjà vu » est stocké côté navigateur — il n'existe
// pas de table de notifications, et en créer une pour ça serait disproportionné.
//
// À la toute première ouverture le repère est posé à maintenant : le compteur
// démarre donc à zéro et ne signale que les arrivées réelles, au lieu d'annoncer
// d'emblée tout l'historique.
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Dropdown, Empty, List, Tag, Tooltip, Typography, theme } from "antd";
import { BellOutlined, SwapOutlined, UserAddOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useMarkNotificationRead, useNewCandidates, useNotifications } from "@/api/hooks";
import type { AppNotification, Candidate } from "@/api/types";

const SEEN_KEY = "candidates-seen-at";
const MAX_SHOWN = 8;

function readSeenAt(): string {
  const stored = localStorage.getItem(SEEN_KEY);
  if (stored) return stored;
  const now = new Date().toISOString();
  localStorage.setItem(SEEN_KEY, now);
  return now;
}

/** « il y a 3 h », « il y a 2 j » — relatif, plus lisible qu'une date ici. */
function relative(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

export default function NotificationsBell() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { data } = useNewCandidates();
  // Notifications persistées (demandes d’échange…) : elles portent leur propre
  // état « lu » en base, indépendant du repère local des nouveaux candidats.
  const { data: notifs } = useNotifications();
  const markRead = useMarkNotificationRead();
  const [seenAt, setSeenAt] = useState<string>(readSeenAt);
  const [open, setOpen] = useState(false);

  // Les plus récents d'abord ; l'API ne garantit pas l'ordre.
  const recent = useMemo(() => {
    const rows = [...(data ?? [])].filter((c) => c.created_at);
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return rows.slice(0, MAX_SHOWN);
  }, [data]);

  const unreadNotifs = (notifs ?? []).filter((n) => !n.read);

  const unseenCandidates = useMemo(
    () => (data ?? []).filter((c) => c.created_at && String(c.created_at) > seenAt).length,
    [data, seenAt],
  );

  const unseen = unseenCandidates + unreadNotifs.length;

  // Ouvrir le panneau vaut lecture, côté navigateur comme côté base.
  useEffect(() => {
    if (!open) return;
    if (unseenCandidates) {
      const now = new Date().toISOString();
      localStorage.setItem(SEEN_KEY, now);
      setSeenAt(now);
    }
    unreadNotifs.forEach((n) => markRead.mutate(n.id));
    // markRead/unreadNotifs changent à chaque rendu : seule l’ouverture compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isUnseen = (c: Candidate) => Boolean(c.created_at && String(c.created_at) > seenAt);

  const panel = (
    <div
      style={{
        width: 340,
        maxHeight: 420,
        overflowY: "auto",
        background: token.colorBgElevated,
        borderRadius: token.borderRadius,
        boxShadow: token.boxShadowSecondary,
        padding: 8,
      }}
    >
      {notifs && notifs.length > 0 && (
        <>
          <div style={{ padding: "6px 8px 10px" }}>
            <Typography.Text strong>Notifications</Typography.Text>
          </div>
          <List
            size="small"
            dataSource={notifs.slice(0, MAX_SHOWN)}
            renderItem={(n: AppNotification) => (
              <List.Item
                style={{ cursor: "pointer", paddingInline: 8 }}
                onClick={() => {
                  setOpen(false);
                  if (n.type.startsWith("offer_switch")) navigate("/demandes-echange");
                }}
              >
                <List.Item.Meta
                  avatar={<SwapOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />}
                  title={
                    <span>
                      {n.title} {!n.read && <Tag color="green">nouveau</Tag>}
                    </span>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {n.body} · {relative(n.created_at)}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        </>
      )}

      <div style={{ padding: "6px 8px 10px" }}>
        <Typography.Text strong>Nouveaux candidats</Typography.Text>
      </div>

      {recent.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aucun candidat pour l'instant" />
      ) : (
        <List
          size="small"
          dataSource={recent}
          renderItem={(c) => (
            <List.Item
              style={{ cursor: "pointer", paddingInline: 8 }}
              onClick={() => {
                setOpen(false);
                navigate("/candidats");
              }}
            >
              <List.Item.Meta
                avatar={<UserAddOutlined style={{ color: token.colorPrimary, fontSize: 18 }} />}
                title={
                  <span>
                    {c.full_name || "Candidat"}{" "}
                    {isUnseen(c) && <Tag color="green">nouveau</Tag>}
                  </span>
                }
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {c.field_of_study || "Filière non renseignée"} · {relative(c.created_at)}
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />
      )}

      <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, marginTop: 4 }}>
        <Button
          type="link"
          block
          onClick={() => {
            setOpen(false);
            navigate("/candidats");
          }}
        >
          Voir tous les candidats
        </Button>
      </div>
    </div>
  );

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={["click"]}
      placement="bottomRight"
      popupRender={() => panel}
    >
      <Tooltip title="Nouveaux candidats">
        <Badge count={unseen} size="small" offset={[-2, 2]}>
          <Button type="text" shape="circle" aria-label="Notifications" icon={<BellOutlined />} />
        </Badge>
      </Tooltip>
    </Dropdown>
  );
}
