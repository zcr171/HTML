# Create README.md
"# test" | Out-File README.md -Append

# Initialize git repository
git init

# Add README.md
git add README.md

# Commit changes
git commit -m "first commit"

# Set main branch
git branch -M main

# Add remote origin
git remote add origin https://github.com/zcr171/test.git

# Push to origin
git push -u origin main