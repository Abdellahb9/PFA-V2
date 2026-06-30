// Explainability (XAI) view of an assignment's composite score: a small radar
// (skills / education / overall) + progress bars. Reads the persisted
// score_breakdown — no new compute. French, AntD + Recharts.
import { Progress, Typography } from "antd";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import type { ScoreBreakdown } from "@/api/types";

const GREEN = "#76B900";

export default function ScoreBreakdownChart({
  breakdown,
  score,
}: {
  breakdown: ScoreBreakdown;
  score?: number | null;
}) {
  const skills = Math.round((breakdown.skills ?? 0) * 100);
  const education = Math.round((breakdown.education ?? 0) * 100);
  const wSkills = breakdown.weights?.skills ?? 0.7;
  const wEducation = breakdown.weights?.education ?? 0.3;
  const overall =
    score != null
      ? Math.round(score * 100)
      : Math.round(((breakdown.skills ?? 0) * wSkills + (breakdown.education ?? 0) * wEducation) * 100);

  const data = [
    { axis: "Compétences", value: skills },
    { axis: "Score global", value: overall },
    { axis: "Études", value: education },
  ];

  return (
    <div style={{ width: 260 }}>
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius={70}>
            <PolarGrid />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="value" stroke={GREEN} fill={GREEN} fillOpacity={0.4} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginTop: 4 }}>
        <Typography.Text style={{ fontSize: 12 }}>Compétences</Typography.Text>
        <Progress percent={skills} size="small" strokeColor="#4A9EFF" />
        <Typography.Text style={{ fontSize: 12 }}>Niveau d'études</Typography.Text>
        <Progress percent={education} size="small" strokeColor="#FAAD14" />
      </div>

      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        Pondération : compétences {wSkills} · études {wEducation}
      </Typography.Text>
    </div>
  );
}
