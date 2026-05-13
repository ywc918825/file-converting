const fetch = require('node-fetch');
const FormData = require('form-data');
const { parse } = require('parse-multipart-data');
const CONVERT_SECRET = '29E4EDmfLee8q4ZKUzA8ioAVLSrTOIH8';  // 替换！

const respond = (code, data) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(data)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { success: false, error: '仅支持 POST' });

  try {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.*)/);
    if (!boundaryMatch) throw new Error('无法获取 boundary');
    const boundary = boundaryMatch[1];
    const bodyBuffer = Buffer.from(event.body, 'base64');
    const parts = parse(bodyBuffer, boundary);

    let fileBuffer = null, fileName = '', targetFormat = 'docx';
    for (const part of parts) {
      if (part.name === 'file') {
        fileBuffer = part.data;
        fileName = part.filename;
      } else if (part.name === 'targetFormat') {
        targetFormat = part.data.toString('utf-8').trim();
      }
    }

    if (!fileBuffer || !fileName) throw new Error('未收到文件');
    console.log(`收到文件: ${fileName}, 大小: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    const fileExt = fileName.split('.').pop().toLowerCase();
    const form = new FormData();
    form.append('File', fileBuffer, { filename: fileName });

    // 添加保真参数
    const parameters = [{ Name: 'StoreFile', Value: true }];
    if (targetFormat === 'pdf' || fileExt.match(/^(jpg|jpeg|png|gif|bmp|webp)$/)) {
      parameters.push({ Name: 'ImageQuality', Value: '100' });
      parameters.push({ Name: 'ImageResolution', Value: '300' });
    }
    const paramsStr = parameters.map(p => `${p.Name}=${p.Value}`).join('&');
    const convertUrl = `https://v2.convertapi.com/convert/${fileExt}/to/${targetFormat}?secret=${CONVERT_SECRET}&${paramsStr}`;

    console.log('调用 ConvertAPI...');
    const response = await fetch(convertUrl, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });

    const data = await response.json();
    if (data.Error) return respond(500, { success: false, error: data.Error });
    if (!data.Files || data.Files.length === 0) return respond(500, { success: false, error: 'ConvertAPI 未返回文件' });

    return respond(200, { success: true, downloadUrl: data.Files[0].Url });
  } catch (err) {
    console.error('云函数错误:', err);
    return respond(500, { success: false, error: err.message || '内部错误' });
  }
};
