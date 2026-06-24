const REGION = process.env.AWS_REGION || 'ap-southeast-2'
const TABLE = 'we-promises'

async function dynamo(action, payload) {
  const url = `https://dynamodb.${REGION}.amazonaws.com`
  const body = JSON.stringify(payload)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStamp = amzDate.slice(0, 8)

  const headers = {
    'Content-Type': 'application/x-amz-json-1.0',
    'X-Amz-Date': amzDate,
    'X-Amz-Target': `DynamoDB_20120810.${action}`,
    'Host': `dynamodb.${REGION}.amazonaws.com`,
  }

  // AWS Signature V4
  const accessKey = process.env.AWS_ACCESS_KEY_ID
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY

  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k.toLowerCase()}:${headers[k]}`).join('\n') + '\n'
  const signedHeaders = Object.keys(headers).sort().map(k => k.toLowerCase()).join(';')

  const crypto = await import('crypto')
  const payloadHash = crypto.createHash('sha256').update(body).digest('hex')
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = `${dateStamp}/${REGION}/dynamodb/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')

  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretKey, dateStamp), REGION), 'dynamodb'), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Authorization': authHeader },
    body,
  })
  return res.json()
}

function toItem(obj) {
  const marshall = (v) => {
    if (typeof v === 'string') return { S: v }
    if (typeof v === 'number') return { N: String(v) }
    if (typeof v === 'boolean') return { BOOL: v }
    if (Array.isArray(v)) return { L: v.map(marshall) }
    if (v && typeof v === 'object') return { M: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, marshall(val)])) }
    return { S: String(v ?? '') }
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, marshall(v)]))
}

function fromItem(item) {
  const unmarshall = (v) => {
    if (v.S !== undefined) return v.S
    if (v.N !== undefined) return Number(v.N)
    if (v.BOOL !== undefined) return v.BOOL
    if (v.L !== undefined) return v.L.map(unmarshall)
    if (v.M !== undefined) return Object.fromEntries(Object.entries(v.M).map(([k, val]) => [k, unmarshall(val)]))
    return null
  }
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unmarshall(v)]))
}

export async function GET() {
  try {
    const data = await dynamo('Scan', { TableName: TABLE })
    const items = (data.Items || []).map(fromItem).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    return Response.json({ items })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const item = await request.json()
    await dynamo('PutItem', { TableName: TABLE, Item: toItem(item) })
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const { id, status, verdictHistory } = await request.json()
    await dynamo('UpdateItem', {
      TableName: TABLE,
      Key: { id: { S: id } },
      UpdateExpression: 'SET #s = :s, verdictHistory = :h',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':s': { S: status },
        ':h': { L: verdictHistory.map(h => ({ M: toItem(h) })) }
      }
    })
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
