from django import forms
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render

from core.forms import BootstrapMixin

from .models import User


class ProfileForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = User
        fields = ["first_name", "last_name", "email", "phone", "job_title"]


@login_required
def profile(request):
    form = ProfileForm(request.POST or None, instance=request.user)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Profile updated.")
        return redirect("accounts:profile")
    return render(request, "accounts/profile.html", {"form": form})
