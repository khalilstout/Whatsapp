#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Helm upgrade --install sur k3s
#
# Le build et push des images est fait automatiquement par GitHub Actions
# (.github/workflows/docker-build.yml) sur chaque push sur main.
# Ce script installe/met à jour simplement le chart Helm sur k3s.
#
# Prerequisites (une seule fois) :
#   1. kubectl configuré pour k3s (copier /etc/rancher/k3s/k3s.yaml → ~/.kube/config,
#      remplacer 127.0.0.1 par l'IP du serveur)
#   2. Helm 3 installé (brew install helm)
#   3. Créer un PAT GitHub avec uniquement le scope 'read:packages'
#      (pour que k3s puisse puller les images depuis ghcr.io)
#
# Usage :
#   export GHCR_TOKEN=ghp_xxx   # PAT read:packages uniquement
#   ./deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_OWNER="khalilstout"
NAMESPACE="whatsapp-ai"
RELEASE="whatsapp"
CHART_DIR="$(cd "$(dirname "$0")/helm/whatsapp-ai" && pwd)"

# ── Namespace ─────────────────────────────────────────────────────────────────
echo "── Namespace ${NAMESPACE} ───────────────────────────────────────────────"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# ── GHCR pull secret (read:packages seulement) ────────────────────────────────
if [[ -n "${GHCR_TOKEN:-}" ]]; then
    kubectl create secret docker-registry ghcr-secret \
        --docker-server=ghcr.io \
        --docker-username="${REPO_OWNER}" \
        --docker-password="${GHCR_TOKEN}" \
        --namespace="${NAMESPACE}" \
        --dry-run=client -o yaml | kubectl apply -f -
    echo "✓ ghcr-secret configuré (read:packages)"
else
    echo "⚠ GHCR_TOKEN non défini — le secret ghcr-secret doit déjà exister"
    echo "  export GHCR_TOKEN=ghp_xxx && ./deploy.sh"
fi

# ── Helm upgrade --install ─────────────────────────────────────────────────────
echo ""
echo "── Helm upgrade --install ────────────────────────────────────────────────"
helm upgrade --install "${RELEASE}" "${CHART_DIR}" \
    --namespace "${NAMESPACE}" \
    --timeout 5m

echo ""
echo "✅ Deploy lancé ! Vérifier les pods :"
echo "   kubectl get pods -n ${NAMESPACE} -w"
echo ""
echo "Première fois ? Migrer les données WhatsApp :"
echo "   ./migrate-data.sh"

# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Build, push images to GHCR, then helm upgrade --install on k3s
#
# Prerequisites (run once):
#   1. Create GitHub PAT with 'write:packages' + 'read:packages' scope
#   2. export GHCR_TOKEN=ghp_xxx
#   3. echo $GHCR_TOKEN | docker login ghcr.io -u khalilstout --password-stdin
#   4. kubectl pointing to k3s (copy /etc/rancher/k3s/k3s.yaml → ~/.kube/config)
#   5. Helm 3 installed (brew install helm)
#   6. docker buildx installed (included with Docker Desktop)
#
# Steps (in order for first deploy):
#   1. export GHCR_TOKEN=ghp_xxx
#   2. ./deploy.sh              → build + push + helm install
#   3. ./migrate-data.sh        → copy session + DB to k3s PVC (ONCE)
#   4. kubectl rollout restart deployment/whatsapp-ai-backend -n whatsapp-ai
#
# Subsequent deploys (code only, no data migration needed):
#   export GHCR_TOKEN=ghp_xxx && ./deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_OWNER="khalilstout"
REGISTRY="ghcr.io/${REPO_OWNER}"
NAMESPACE="whatsapp-ai"
RELEASE="whatsapp"
CHART_DIR="$(cd "$(dirname "$0")/helm/whatsapp-ai" && pwd)"

# Target platform for k3s server (linux/amd64 for most VPS, linux/arm64 for Pi)
PLATFORM="${PLATFORM:-linux/amd64}"

# ── 1. Build & Push ──────────────────────────────────────────────────────────
if [[ "${1:-}" != "--helm-only" ]]; then
    echo "── Building Docker images for ${PLATFORM} ───────────────────────────────"

    docker buildx build \
        --platform "${PLATFORM}" \
        --push \
        -t "${REGISTRY}/whatsapp-backend:latest" \
        ./backend

    docker buildx build \
        --platform "${PLATFORM}" \
        --push \
        -t "${REGISTRY}/whatsapp-frontend:latest" \
        ./frontend

    echo "✓ Images pushed to ${REGISTRY}"
fi

# ── 2. Namespace ─────────────────────────────────────────────────────────────
echo ""
echo "── Creating namespace ${NAMESPACE} ──────────────────────────────────────"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# ── 3. GHCR pull secret ──────────────────────────────────────────────────────
if [[ -n "${GHCR_TOKEN:-}" ]]; then
    kubectl create secret docker-registry ghcr-secret \
        --docker-server=ghcr.io \
        --docker-username="${REPO_OWNER}" \
        --docker-password="${GHCR_TOKEN}" \
        --namespace="${NAMESPACE}" \
        --dry-run=client -o yaml | kubectl apply -f -
    echo "✓ ghcr-secret configured"
else
    echo "⚠ Set GHCR_TOKEN to auto-create the pull secret"
    echo "  export GHCR_TOKEN=ghp_xxx && ./deploy.sh --helm-only"
fi

# ── 4. Helm install ──────────────────────────────────────────────────────────
echo ""
echo "── Helm upgrade --install ────────────────────────────────────────────────"
helm upgrade --install "${RELEASE}" "${CHART_DIR}" \
    --namespace "${NAMESPACE}" \
    --timeout 5m

echo ""
echo "✅ Deploy started! Check pods:"
echo "   kubectl get pods -n ${NAMESPACE} -w"
echo ""
echo "First time? Migrate your WhatsApp session & DB:"
echo "   ./migrate-data.sh"

REGISTRY="ghcr.io/${REPO_OWNER}"
NAMESPACE="whatsapp-ai"
RELEASE="whatsapp"
CHART_DIR="$(cd "$(dirname "$0")/helm/whatsapp-ai" && pwd)"

if [[ "${1:-}" != "--helm-only" ]]; then
    echo "── Building Docker images ────────────────────────────────────────────"

    docker build \
        -t "${REGISTRY}/whatsapp-backend:latest" \
        ./backend
    docker build \
        -t "${REGISTRY}/whatsapp-frontend:latest" \
        ./frontend

    echo "── Pushing to GHCR ───────────────────────────────────────────────────"
    echo "  (Make sure you ran: echo TOKEN | docker login ghcr.io -u ${REPO_OWNER} --password-stdin)"

    docker push "${REGISTRY}/whatsapp-backend:latest"
    docker push "${REGISTRY}/whatsapp-frontend:latest"
fi

echo "── Helm upgrade --install ────────────────────────────────────────────────"
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install "${RELEASE}" "${CHART_DIR}" \
    --namespace "${NAMESPACE}" \
    --wait \
    --timeout 5m

echo ""
echo "✅ Deployed! Check pod status:"
echo "   kubectl get pods -n ${NAMESPACE}"
