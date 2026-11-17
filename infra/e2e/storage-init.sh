set -e
E="--endpoint-url http://storage:9000"
for i in $(seq 1 30); do aws $E s3api list-buckets >/dev/null 2>&1 && break; sleep 1; done
aws $E s3api create-bucket --bucket selly-public 2>/dev/null || true
aws $E s3api create-bucket --bucket selly-private 2>/dev/null || true
aws $E s3api put-bucket-policy --bucket selly-public --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::selly-public/*"]}]}'
aws $E s3api put-bucket-lifecycle-configuration --bucket selly-private --lifecycle-configuration '{"Rules":[{"ID":"expire-originals","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":30}}]}'
aws $E s3api get-bucket-lifecycle-configuration --bucket selly-private
echo storage ready