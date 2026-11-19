export const hasBilling = document.querySelector('meta[name="drivescene-billing"]') !== null;

export async function billingRequest(path, body) {
 const response = await fetch('/api/pro/' + path, body === undefined
  ? {cache:'no-store'}
  : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const result = await response.json();
 if (!response.ok) throw Error(result.error || 'The request could not be completed.');
 return result;
}
