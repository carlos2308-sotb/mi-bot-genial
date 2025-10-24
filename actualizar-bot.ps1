# Script: actualizar-bot.ps1
# Descripción: Agrega, hace commit y sube tu bot a GitHub automáticamente

# Preguntar al usuario por el mensaje del commit
$mensaje = Read-Host "Actualizado"

# Agregar todos los archivos
git add .

# Hacer commit con el mensaje ingresado
git commit -m "$mensaje"

# Subir los cambios a GitHub
git push

Write-Host "¡Bot actualizado en GitHub con éxito!" -ForegroundColor Green
