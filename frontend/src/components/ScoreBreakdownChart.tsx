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
import useChartTheme from "@/theme/useChartTheme";
import type { ScoreBreakdown } from "@/api/types";

export default function ScoreBreakdownChart({
  breakdown,
  score,
}: {
  breakdown: ScoreBreakdown;
  score?: number | null;
}) {
  const chart = useChartTheme();
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
            <PolarGrid stroke={chart.gridProps.stroke} />
            <PolarAngleAxis dataKey="axis" tick={{ ...chart.axisTick, fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              dataKey="value"
              stroke={chart.brand}
              strokeWidth={2}
              fill={chart.brand}
              fillOpacity={0.25}
              isAnimationActive={chart.animate}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginTop: 4 }}>
        <Typography.Text style={{ fontSize: 12 }}>Compétences</Typography.Text>
        <Progress percent={skills} size="small" strokeColor={chart.semantic.info} />
        <Typography.Text style={{ fontSize: 12 }}>Niveau d'études</Typography.Text>
        <Progress percent={education} size="small" strokeColor={chart.semantic.warning} />
      </div>

      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        Pondération : compétences {wSkills} · études {wEducation}
      </Typography.Text>
    </div>
  );
}
