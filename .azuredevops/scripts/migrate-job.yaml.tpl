# Migration Job, rendered with envsubst (IMAGE, JOB) by k8s-deploy.
#
# Reprend infra/k8s/base/migrate-job.yaml — meme ServiceAccount (donc meme
# role IRSA), meme montage de secrets et meme contexte de securite — but pinned to the image about to ship, and run while
# the current version is still serving. Kept in sync with that file by hand;
# it is the single imperative step of the rollout.
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB}
  namespace: diav1
  labels:
    app.kubernetes.io/name: db-migrate
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 900
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app.kubernetes.io/name: db-migrate
    spec:
      serviceAccountName: jobs
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: migrate
          image: ${IMAGE}
          command: ["python", "-m", "app.db.migrate"]
          envFrom:
            - configMapRef:
                name: app-config
            - secretRef:
                name: diav1-secrets
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: secrets-store
              mountPath: /mnt/secrets
              readOnly: true
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: secrets-store
          csi:
            driver: secrets-store.csi.k8s.io
            readOnly: true
            volumeAttributes:
              secretProviderClass: diav1-secrets
        - name: tmp
          emptyDir: {}
