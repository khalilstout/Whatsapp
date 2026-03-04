{{/*
Expand the name of the chart.
*/}}
{{- define "whatsapp-ai.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "whatsapp-ai.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label
*/}}
{{- define "whatsapp-ai.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "whatsapp-ai.labels" -}}
helm.sh/chart: {{ include "whatsapp-ai.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Backend-specific names and selectors
*/}}
{{- define "whatsapp-ai.backend.name" -}}
{{- printf "%s-backend" (include "whatsapp-ai.fullname" .) }}
{{- end }}

{{- define "whatsapp-ai.backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "whatsapp-ai.name" . }}-backend
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Frontend-specific names and selectors
*/}}
{{- define "whatsapp-ai.frontend.name" -}}
{{- printf "%s-frontend" (include "whatsapp-ai.fullname" .) }}
{{- end }}

{{- define "whatsapp-ai.frontend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "whatsapp-ai.name" . }}-frontend
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Backend service DNS name (used by the nginx ConfigMap to proxy Socket.IO)
*/}}
{{- define "whatsapp-ai.backend.serviceFQDN" -}}
{{- printf "%s.%s.svc.cluster.local" (include "whatsapp-ai.backend.name" .) .Release.Namespace }}
{{- end }}
