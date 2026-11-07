function connectionAdvice(service, error) {
  const code = error?.code;
  if (service === 'SMTP') {
    if (code === 'EAUTH' || error?.responseCode === 535) return 'SMTP authentication failed. Check SMTP_USER and SMTP_PASS; Gmail requires a current app password with 2-Step Verification enabled.';
    if (code === 'EENVELOPE' || error?.responseCode === 550) return 'SMTP rejected the sender or recipient. Check EMAIL_FROM, the student address, and your provider sender restrictions.';
    if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET') return 'SMTP connection failed. Check SMTP_HOST, port 465 or 587, firewall rules, and provider availability. Certificate verification remains enabled.';
    if (code === 'EDNS' || code === 'ENOTFOUND') return 'SMTP host could not be resolved. Check SMTP_HOST and DNS access.';
    return 'SMTP request failed. Check the SMTP host, app password, verified sender, TLS and provider sending limits.';
  }
  if (error?.http_code === 401 || error?.http_code === 403) return 'Cloudinary authentication failed. Check that cloud name, API key and API secret belong to the same active account.';
  if (error?.http_code === 400) return 'Cloudinary rejected the request. Check the cloud name, supported image format, and account upload restrictions.';
  return 'Cloudinary connection failed. Check CLOUDINARY_CLOUD_NAME, API credentials, network access and account status.';
}
module.exports = { connectionAdvice };
