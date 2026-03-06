#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# migrate-data.sh — Copy WhatsApp session + SQLite DB into the k3s PVC
#
# Run ONCE before the first helm install, or to restore data from backup.
# The PVC must already exist (run deploy.sh --helm-only first if needed).
#
# What it copies (from ./data/) → /app/.wwebjs_auth/ inside PVC:
#   registry.json          — sessions list
#   session-khalil/        — WhatsApp Chromium LocalAuth session folder
#   messages.db            — SQLite DB with all messages
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

NAMESPACE="whatsapp-ai"
PVC_NAME="whatsapp-ai-backend-auth"
LOCAL_DATA="$(cd "$(dirname "$0")/data" && pwd)"
TEMP_POD="data-migrator"

echo "── Data to migrate: ${LOCAL_DATA} ───────────────────────────────────────"
ls -la "${LOCAL_DATA}"

# ── Step 1: make sure PVC exists ────────────────────────────────────────────
echo ""
echo "── Checking PVC ${PVC_NAME} in namespace ${NAMESPACE} ───────────────────"
if ! kubectl get pvc "${PVC_NAME}" -n "${NAMESPACE}" &>/dev/null; then
    echo "PVC not found. Running helm install first to create it..."
    kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
    helm upgrade --install whatsapp \
        "$(cd "$(dirname "$0")/helm/whatsapp-ai" && pwd)" \
        --namespace "${NAMESPACE}" \
        --timeout 2m \
        --wait=false  # don't wait — backend needs session data to start
    echo "Waiting 15s for PVC to be created..."
    sleep 15
fi
kubectl get pvc "${PVC_NAME}" -n "${NAMESPACE}"

# ── Step 2: launch a temporary busybox pod that mounts the PVC ─────────────
echo ""
echo "── Launching migrator pod ────────────────────────────────────────────────"
kubectl delete pod "${TEMP_POD}" -n "${NAMESPACE}" --ignore-not-found

kubectl apply -f - -n "${NAMESPACE}" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${TEMP_POD}
  namespace: ${NAMESPACE}
spec:
  restartPolicy: Never
  containers:
    - name: migrator
      image: busybox:1.36
      command: ["sh", "-c", "echo ready && sleep 3600"]
      volumeMounts:
        - name: auth-data
          mountPath: /data
  volumes:
    - name: auth-data
      persistentVolumeClaim:
        claimName: ${PVC_NAME}
EOF

echo "Waiting for migrator pod to be ready..."
kubectl wait pod "${TEMP_POD}" -n "${NAMESPACE}" \
    --for=condition=Ready --timeout=60s

# ── Step 3: copy data ────────────────────────────────────────────────────────
echo ""
echo "── Copying data into PVC ────────────────────────────────────────────────"

# Copy registry.json
if [[ -f "${LOCAL_DATA}/registry.json" ]]; then
    kubectl cp "${LOCAL_DATA}/registry.json" \
        "${NAMESPACE}/${TEMP_POD}:/data/registry.json"
    echo "  ✓ registry.json"
fi

# Copy messages.db
if [[ -f "${LOCAL_DATA}/messages.db" ]]; then
    kubectl cp "${LOCAL_DATA}/messages.db" \
        "${NAMESPACE}/${TEMP_POD}:/data/messages.db"
    echo "  ✓ messages.db ($(du -sh "${LOCAL_DATA}/messages.db" | cut -f1))"
fi

# Copy session-khalil/ (WhatsApp LocalAuth) — can be large
for SESSION_DIR in "${LOCAL_DATA}"/session-*/; do
    if [[ -d "${SESSION_DIR}" ]]; then
        SESSION_NAME=$(basename "${SESSION_DIR}")
        echo "  Copying ${SESSION_NAME}/ ..."
        kubectl cp "${SESSION_DIR}" \
            "${NAMESPACE}/${TEMP_POD}:/data/${SESSION_NAME}/"
        echo "  ✓ ${SESSION_NAME}/"
    fi
done

# ── Step 4: verify ───────────────────────────────────────────────────────────
echo ""
echo "── Verifying data in PVC ────────────────────────────────────────────────"
kubectl exec "${TEMP_POD}" -n "${NAMESPACE}" -- \
    sh -c "find /data -maxdepth 2 -name '*.json' -o -name '*.db' | head -20 && echo '' && du -sh /data"

# ── Step 5: cleanup ──────────────────────────────────────────────────────────
echo ""
echo "── Cleaning up migrator pod ─────────────────────────────────────────────"
kubectl delete pod "${TEMP_POD}" -n "${NAMESPACE}"

echo ""
echo "✅ Migration complete!"
echo "   Run: kubectl rollout restart deployment/whatsapp-ai-backend -n ${NAMESPACE}"
echo "   Or:  ./deploy.sh --helm-only"
