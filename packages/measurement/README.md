# Measurement CLI 이전 안내

CLI의 소스·빌드·테스트·공통 파일 어댑터는 [hypeproof-service/packages/measurement](https://github.com/hypeproof/hypeproof-service/tree/main/packages/measurement)로 이전했습니다.

설치:

```sh
npm install -g https://github.com/hypeproof/hypeproof-service/releases/download/measurement-v0.3.5/hypeproof-measurement-0.3.5.tgz
```

CLI는 로컬에서 실행되며 기존 Lab 동기화 주소를 유지합니다. 운영 Worker 배포와 별개입니다.

이 디렉토리는 레지스트리·추적 참조 정리 전까지 유지하는 임시 호환성 검증 경로입니다. `npm test`는 설치한 Service 배포 파일을 복사하여 기존 synthetic 테스트를 실행합니다. 기존 src의 CLI 파일은 이 빌드에 사용하지 않으며 수정 소유자는 Service입니다. 레지스트리 연결 이슈 #9와 최종 정리 단계에서 옛 파일을 제거합니다.
