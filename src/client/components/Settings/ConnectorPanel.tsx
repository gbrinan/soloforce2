import { useCallback, useEffect, useState } from "react";
import { Card, Group, Stack, Text, Badge, Button, Alert, LoadingOverlay, Code } from "@mantine/core";
import { IconAlertTriangle, IconBrandGoogle, IconNote, IconPlug } from "@tabler/icons-react";
import { listConnectors, startConnectorOAuth, revokeConnector, type ConnectorStatus } from "../../utils/api";

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  google: <IconBrandGoogle size={18} />,
  notion: <IconNote size={18} />,
};

/**
 * 커넥터 연결 화면 — 서비스 정책 표(ServicePolicyPanel)가 "어떻게 쓸지"를 정한다면
 * 여기는 "쓸 수 있는지"를 정한다. 연결되지 않은 서비스는 에이전트에게 도구가 아예 없다.
 */
export function ConnectorPanel() {
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listConnectors().then((next) => {
      setConnectors(next);
      setLoading(false);
    });
  }, []);

  useEffect(refresh, [refresh]);

  const connect = async (provider: string) => {
    setBusy(provider);
    const result = await startConnectorOAuth(provider);
    setBusy(null);
    if (!result.ok || !result.authorizationUrl) return;
    // 동의 화면은 별창으로 — 콜백 페이지가 스스로 닫히면 목록을 다시 읽는다.
    const popup = window.open(result.authorizationUrl, "_blank", "width=520,height=680");
    const timer = window.setInterval(() => {
      if (popup?.closed !== false) {
        window.clearInterval(timer);
        refresh();
      }
    }, 1000);
  };

  const disconnect = async (provider: string) => {
    setBusy(provider);
    const result = await revokeConnector(provider);
    setBusy(null);
    if (result.connectors) setConnectors(result.connectors);
    else refresh();
  };

  return (
    <Stack gap="sm" pos="relative" p="xs">
      <LoadingOverlay visible={loading} />
      <Text size="xs" c="dimmed">
        연결한 계정만 에이전트의 도구가 됩니다. 연결 후 세부 권한(자동/승인)은 아래 서비스 정책에서 정합니다.
      </Text>

      {connectors.map((connector) => (
        <Card key={connector.provider} withBorder radius="md" p="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Stack gap={4} style={{ minWidth: 0 }}>
              <Group gap={6}>
                {PROVIDER_ICONS[connector.provider] ?? <IconPlug size={18} />}
                <Text size="sm" fw={600}>{connector.label}</Text>
                <StateBadge state={connector.state} />
              </Group>
              {connector.accountLabel && (
                <Text size="xs" c="dimmed" truncate>{connector.accountLabel}</Text>
              )}
              {!connector.configured && (
                <Text size="xs" c="dimmed">
                  .env에 OAuth 자격증명이 없습니다 — <Code>.env.example</Code>의 커넥터 항목을 참고하세요.
                </Text>
              )}
            </Stack>
            <Group gap="xs" wrap="nowrap">
              {connector.state !== "not_connected" && (
                <Button
                  size="xs" variant="subtle" color="red"
                  loading={busy === connector.provider}
                  onClick={() => disconnect(connector.provider)}
                >
                  연결 해제
                </Button>
              )}
              <Button
                size="xs"
                variant={connector.state === "connected" ? "light" : "filled"}
                disabled={!connector.connectUrl || connector.state === "misconfigured"}
                loading={busy === connector.provider}
                onClick={() => connect(connector.provider)}
              >
                {connector.state === "connected" ? "다시 연결" : "연결"}
              </Button>
            </Group>
          </Group>

          {connector.state === "needs_reauth" && (
            <Alert mt="xs" p="xs" variant="light" color="orange" icon={<IconAlertTriangle size={14} />}>
              <Text size="xs">
                토큰이 만료됐고 자동 갱신이 거부됐습니다. 다시 연결하세요.
                {connector.lastError ? ` (${connector.lastError})` : ""}
              </Text>
            </Alert>
          )}

          {/* 설정 오류에 재연결을 권하지 않는다 — 원인이 .env라서 눌러도 안 고쳐진다. */}
          {connector.state === "misconfigured" && (
            <Alert mt="xs" p="xs" variant="light" color="red" icon={<IconAlertTriangle size={14} />}>
              <Text size="xs">
                OAuth 클라이언트 설정이 잘못됐습니다 — <b>재연결해도 고쳐지지 않습니다.</b>{" "}
                <Code>.env</Code>의 클라이언트 ID/시크릿을 확인하고 서버를 재시작하세요.
                {connector.lastError ? ` (${connector.lastError})` : ""}
              </Text>
            </Alert>
          )}
        </Card>
      ))}
    </Stack>
  );
}

function StateBadge({ state }: { state: ConnectorStatus["state"] }) {
  if (state === "connected") return <Badge size="xs" color="green" variant="light">연결됨</Badge>;
  if (state === "needs_reauth") return <Badge size="xs" color="orange" variant="light">재연결 필요</Badge>;
  if (state === "misconfigured") return <Badge size="xs" color="red" variant="light">설정 오류</Badge>;
  return <Badge size="xs" color="gray" variant="light">미연결</Badge>;
}
